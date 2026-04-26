import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jBoolean,
  neo4jNullableDateTimeString,
  neo4jNullableNumber,
  neo4jNullableString,
  neo4jNumber,
  neo4jString,
  neo4jStringArray,
} from './_shared/neo4jMap';
import type { ToolDefinition } from './types';
import { inputSchema, type SearchCasesInput, type CaseSearchHit } from './searchCases/schema';
import { buildSearchCypher } from './searchCases/cypher';
import { z } from 'zod';

export type { CaseSearchHit };

export interface SearchCasesResult {
  hits: CaseSearchHit[];
  totalMatches: number;
  returnedCount: number;
  truncated: boolean;
  meta: QueryMeta;
}

const toCleanStringArray = (v: unknown): string[] =>
  Array.isArray(v)
    ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)))
    : [];

const rowSchema = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseNumber: neo4jNullableString,
  caseType: neo4jString,
  legalStage: neo4jString,
  status: neo4jNullableString,
  completionRate: neo4jNumber,
  monthsSinceEvent: neo4jNullableNumber,
  monthsToSoL: neo4jNullableNumber,
  isOverdue: z.union([neo4jBoolean, z.null()]),
  eventDate: neo4jNullableDateTimeString,
  createdAt: neo4jNullableDateTimeString,
  signedAt: neo4jNullableDateTimeString,
  mainInjury: neo4jNullableString,
  clientName: neo4jNullableString,
  missingCriticalCount: neo4jNumber,
  documentCount: neo4jNumber,
  insurers: neo4jStringArray,
  injuries: neo4jStringArray,
});

async function execute(input: SearchCasesInput): Promise<SearchCasesResult> {
  const { cypher, countCypher, params } = buildSearchCypher(input);
  const { rows, meta } = await runReadQueryWithMeta(cypher, params, rowSchema);
  const countRows = await runReadQueryWithMeta(
    countCypher,
    params,
    z.object({ total: neo4jNumber })
  );
  const totalMatches = countRows.rows[0]?.total ?? rows.length;

  const hits: CaseSearchHit[] = rows.map((r) => ({
    caseId: r.caseId,
    caseName: r.caseName,
    caseNumber: r.caseNumber,
    caseType: r.caseType,
    legalStage: r.legalStage,
    status: r.status,
    completionRate: r.completionRate,
    monthsSinceEvent: r.monthsSinceEvent,
    monthsToSoL: r.monthsToSoL,
    isOverdue: r.isOverdue,
    eventDate: r.eventDate,
    createdAt: r.createdAt,
    signedAt: r.signedAt,
    mainInjury: r.mainInjury,
    clientName: r.clientName,
    missingCriticalCount: r.missingCriticalCount,
    documentCount: r.documentCount,
    insurers: toCleanStringArray(r.insurers),
    injuries: toCleanStringArray(r.injuries),
  }));

  return {
    hits,
    totalMatches,
    returnedCount: hits.length,
    truncated: hits.length < totalMatches,
    meta: { ...meta, rowCount: totalMatches },
  };
}

export const searchCasesTool: ToolDefinition<typeof inputSchema, SearchCasesResult> = {
  name: 'searchCases',
  label: 'Searching cases by filters',
  inputSchema,
  execute,
  summarize: (r) => {
    if (r.hits.length === 0) return 'No cases match filters';
    const [first] = r.hits;
    if (r.hits.length === 1 && first) return `1 matching case: ${first.caseName}`;
    return r.truncated
      ? `${r.returnedCount} of ${r.totalMatches} matching cases`
      : `${r.returnedCount} matching cases`;
  },
  extractEvidence: (r) =>
    r.hits.map((c) => ({
      sourceType: 'Case' as const,
      sourceId: c.caseId,
      label: c.caseName || c.caseId,
      viaTool: 'searchCases',
    })),
  traceMeta: (r) => r.meta,
};
