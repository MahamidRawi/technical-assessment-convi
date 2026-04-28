import { z } from 'zod';
import neo4j from 'neo4j-driver';
import { connectNeo4j, createSession } from '@/db/neo4j';
import type { ToolDefinition } from './types';
import type { QueryMeta } from './_shared/runReadQueryWithMeta';

const MAX_ROWS = 100;
const MAX_STRING_CHARS = 500;
const MAX_ARRAY_ITEMS = 50;
const MAX_DEPTH = 4;
const QUERY_TIMEOUT_MS = 5000;

// Mutating keywords + procedure CALLs are rejected with a clear message before
// the query reaches Neo4j. Real safety is `session.executeRead`, which would
// also fail any write at the transaction level — this is just early feedback so
// the agent does not waste a step learning the constraint.
//
// `CALL { ... }` and `CALL (var) { ... }` subqueries are allowed (read-only when
// the inner query is read-only); `CALL <name>(...)` procedure calls are not,
// because procedures can mutate state or do work that bypasses the read txn.
const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/(?<!\.)\bCREATE\b(?!\.)/i, 'CREATE'],
  [/(?<!\.)\bMERGE\b(?!\.)/i, 'MERGE'],
  [/(?<!\.)\bDELETE\b(?!\.)/i, 'DELETE'],
  [/(?<!\.)\bSET\b(?!\.)/i, 'SET'],
  [/(?<!\.)\bREMOVE\b(?!\.)/i, 'REMOVE'],
  [/(?<!\.)\bDROP\b(?!\.)/i, 'DROP'],
  [/(?<!\.)\bLOAD\b(?!\.)/i, 'LOAD'],
  [/(?<!\.)\bFOREACH\b(?!\.)/i, 'FOREACH'],
  [/\bCALL\b(?!\s*[{(])/i, 'CALL <procedure>'],
];

function stripCommentsAndStrings(cypher: string): string {
  return cypher
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\'|[^'])*'/g, "''")
    .replace(/"(?:\\"|[^"])*"/g, '""');
}

export function validateReadOnlyCypher(cypher: string): string | null {
  const trimmed = cypher.trim();
  if (!trimmed) return 'Cypher query is empty.';
  const stripped = stripCommentsAndStrings(trimmed);
  const withoutTrailing = stripped.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return 'Multi-statement queries are not allowed; pass a single Cypher statement.';
  }
  for (const [pattern, keyword] of FORBIDDEN_PATTERNS) {
    if (pattern.test(stripped)) {
      return `Cypher keyword "${keyword}" is not allowed in runReadOnlyCypher; this tool is read-only. Pass string literals as parameters if you need a value that looks like a keyword.`;
    }
  }
  return null;
}

function isNeo4jTemporal(value: unknown): boolean {
  return (
    neo4j.isDate(value) ||
    neo4j.isDateTime(value) ||
    neo4j.isLocalDateTime(value) ||
    neo4j.isTime(value) ||
    neo4j.isLocalTime(value) ||
    neo4j.isDuration(value)
  );
}

export function normalizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[max depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_CHARS
      ? `${value.slice(0, MAX_STRING_CHARS)}…`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (neo4j.isInt(value)) return (value as { toNumber(): number }).toNumber();
  if (isNeo4jTemporal(value)) return String(value);
  if (Array.isArray(value)) {
    const truncated = value.length > MAX_ARRAY_ITEMS;
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((v) => normalizeValue(v, depth + 1));
    return truncated ? [...items, `[+${value.length - MAX_ARRAY_ITEMS} more]`] : items;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('labels' in obj && 'properties' in obj) {
      return {
        labels: obj.labels,
        properties: normalizeValue(obj.properties, depth + 1),
      };
    }
    if ('type' in obj && 'properties' in obj && 'start' in obj && 'end' in obj) {
      return {
        type: obj.type,
        properties: normalizeValue(obj.properties, depth + 1),
      };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = normalizeValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

const inputSchema = z.object({
  cypher: z
    .string()
    .min(1)
    .describe(
      'Read-only Cypher query. Allowed: MATCH, OPTIONAL MATCH, WITH, UNWIND, RETURN, ORDER BY, SKIP, LIMIT, CALL { ... } subqueries. Rejected: CREATE, MERGE, DELETE, SET, REMOVE, DROP, CALL <procedure>, LOAD, FOREACH. Server-side timeout 5s, max 100 rows returned (truncated otherwise), strings >500 chars truncated. Use $params for string literals to avoid keyword collisions in the validator.'
    ),
  params: z
    .record(z.unknown())
    .optional()
    .describe('Optional Cypher parameters, e.g. { caseId: "abc123" }.'),
});

export interface RunReadOnlyCypherResult {
  rows: Record<string, unknown>[];
  returnedRowCount: number;
  totalRowCount: number;
  truncated: boolean;
  meta: QueryMeta;
}

async function execute({
  cypher,
  params,
}: z.infer<typeof inputSchema>): Promise<RunReadOnlyCypherResult> {
  const violation = validateReadOnlyCypher(cypher);
  if (violation) throw new Error(violation);

  await connectNeo4j();
  const session = createSession();
  try {
    const queryParams = params ?? {};
    const records = await session.executeRead(
      async (tx) => {
        const result = await tx.run(cypher, queryParams);
        return result.records;
      },
      { timeout: QUERY_TIMEOUT_MS }
    );
    const allRows = records.map((r) => r.toObject() as Record<string, unknown>);
    const truncated = allRows.length > MAX_ROWS;
    const rows = allRows.slice(0, MAX_ROWS).map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = normalizeValue(v);
      }
      return out;
    });
    return {
      rows,
      returnedRowCount: rows.length,
      totalRowCount: allRows.length,
      truncated,
      meta: {
        cypher: cypher.trim(),
        params: queryParams,
        rowCount: allRows.length,
      },
    };
  } finally {
    await session.close();
  }
}

export const runReadOnlyCypherTool: ToolDefinition<typeof inputSchema, RunReadOnlyCypherResult> = {
  name: 'runReadOnlyCypher',
  label: 'Running read-only Cypher',
  inputSchema,
  execute,
  summarize: (result) => {
    const suffix = result.truncated
      ? ` (truncated to ${result.returnedRowCount}/${result.totalRowCount})`
      : '';
    return `${result.returnedRowCount} row${result.returnedRowCount === 1 ? '' : 's'}${suffix}`;
  },
  extractEvidence: () => [],
  traceMeta: (result) => result.meta,
};
