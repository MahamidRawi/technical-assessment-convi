import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import { neo4jNullableString, neo4jNumber, neo4jString } from './_shared/neo4jMap';
import type { ToolDefinition } from './types';

export interface FindCaseHit {
  caseId: string;
  sourceId: string | null;
  caseName: string;
  caseNumber: string | null;
  caseType: string;
  legalStage: string;
  subStage: string | null;
  clientName: string | null;
  rank: number;
  matchReason: string;
}

export interface FindCaseResult {
  hits: FindCaseHit[];
  meta: QueryMeta;
}

export function isAmbiguousFindCase(result: FindCaseResult): boolean {
  const [first, second] = result.hits;
  if (!first || !second) return false;
  return first.rank === second.rank && first.matchReason === second.matchReason;
}

const inputSchema = z.object({
  query: z
    .string()
    .describe('Free-form case reference: canonical caseId, Mongo _id/sourceId, case number, case name, or client name.'),
  limit: z.number().int().min(1).max(10).default(5),
});

const rowSchema = z.object({
  caseId: neo4jString,
  sourceId: neo4jNullableString,
  caseName: neo4jString,
  caseNumber: neo4jNullableString,
  caseType: neo4jString,
  legalStage: neo4jString,
  subStage: neo4jNullableString,
  clientName: neo4jNullableString,
  rank: neo4jNumber,
  matchReason: neo4jString,
});

function extractNumber(query: string): string | null {
  const match = query.match(/\((\d+)\)/) ?? query.match(/(\d{4,})/);
  return match?.[1] ?? null;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s\-_./,()[\]{}]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function execute(input: z.infer<typeof inputSchema>): Promise<FindCaseResult> {
  const extractedNumber = extractNumber(input.query);
  const tokens = tokenize(input.query);
  const firstToken = tokens[0] ?? '';
  const cypher = `
    MATCH (c:Case)
    OPTIONAL MATCH (c)-[:HAS_CLIENT]->(client:Contact)
    WITH c, head(collect(client)) AS client,
         toLower(coalesce(c.caseName, '') + ' ' + coalesce(c.caseNumber, '') + ' ' + coalesce(client.name, '')) AS haystack,
         toLower(coalesce(c.caseNumber, '')) AS caseNumberLc,
         toLower(coalesce(c.caseId, '')) AS caseIdLc,
         toLower(coalesce(c.sourceId, '')) AS sourceIdLc,
         toLower($query) AS queryLc
    WHERE caseIdLc = queryLc
       OR sourceIdLc = queryLc
       OR ($extractedNumber IS NOT NULL AND caseNumberLc CONTAINS toLower($extractedNumber))
       OR (size($tokens) > 0 AND ALL(token IN $tokens WHERE haystack CONTAINS token))
    RETURN c.caseId AS caseId,
           c.sourceId AS sourceId,
           c.caseName AS caseName,
           c.caseNumber AS caseNumber,
           c.caseType AS caseType,
           c.legalStage AS legalStage,
           c.subStage AS subStage,
           client.name AS clientName,
           CASE
             WHEN caseIdLc = queryLc THEN 0
             WHEN sourceIdLc = queryLc THEN 0
             WHEN $extractedNumber IS NOT NULL AND caseNumberLc = toLower($extractedNumber) THEN 0
             WHEN $firstToken <> '' AND toLower(coalesce(c.caseName, '')) STARTS WITH $firstToken THEN 1
             WHEN $firstToken <> '' AND toLower(coalesce(client.name, '')) STARTS WITH $firstToken THEN 2
             ELSE 3
           END AS rank,
           CASE
             WHEN caseIdLc = queryLc THEN 'caseId'
             WHEN sourceIdLc = queryLc THEN 'sourceId'
             WHEN $extractedNumber IS NOT NULL AND caseNumberLc CONTAINS toLower($extractedNumber) THEN 'caseNumber'
             WHEN $firstToken <> '' AND toLower(coalesce(c.caseName, '')) STARTS WITH $firstToken THEN 'caseName'
             WHEN $firstToken <> '' AND toLower(coalesce(client.name, '')) STARTS WITH $firstToken THEN 'clientName'
             ELSE 'tokenMatch'
           END AS matchReason
    ORDER BY rank ASC, c.caseName ASC
    LIMIT toInteger($limit)
  `;
  const { rows, meta } = await runReadQueryWithMeta(
    cypher,
    { query: input.query, extractedNumber, tokens, firstToken, limit: input.limit },
    rowSchema
  );
  return { hits: rows, meta };
}

export const findCaseTool: ToolDefinition<typeof inputSchema, FindCaseResult> = {
  name: 'findCase',
  label: 'Resolving case reference',
  inputSchema,
  execute,
  summarize: (result) => {
    if (result.hits.length === 0) return 'No matching cases';
    const first = result.hits[0];
    if (!first) return 'No matching cases';
    if (isAmbiguousFindCase(result)) {
      return `${result.hits.length} candidate cases; top match is ambiguous`;
    }
    return result.hits.length === 1 ? `Resolved ${first.caseName}` : `${result.hits.length} candidate cases`;
  },
  extractEvidence: (result) =>
    result.hits.map((hit) => ({
      sourceType: 'Case' as const,
      sourceId: hit.caseId,
      label: hit.caseName || hit.caseId,
      viaTool: 'findCase',
    })),
  traceMeta: (result) => result.meta,
};
