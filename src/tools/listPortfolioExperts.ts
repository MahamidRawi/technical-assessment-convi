import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jNullableString,
  neo4jNumber,
  neo4jString,
  neo4jStringArray,
} from './_shared/neo4jMap';
import type { ToolDefinition } from './types';

export interface PortfolioExpertRow {
  key: string;
  name: string;
  specialty: string | null;
  oursCaseCount: number;
  courtCaseCount: number;
  totalCaseCount: number;
  caseIds: string[];
}

export interface PortfolioExpertsResult {
  filterSide: 'ours' | 'court' | null;
  totalMatches: number;
  returnedCount: number;
  truncated: boolean;
  hits: PortfolioExpertRow[];
  meta: QueryMeta;
}

const inputSchema = z.object({
  side: z
    .enum(['ours', 'court'])
    .optional()
    .describe(
      "OMIT to return both sides. Pass 'ours' for experts retained by us, 'court' for court-appointed experts."
    ),
  limit: z.number().int().min(1).max(100).default(25),
});

type Input = z.infer<typeof inputSchema>;

const rowSchema = z.object({
  key: neo4jString,
  name: neo4jString,
  specialty: neo4jNullableString,
  oursCaseCount: neo4jNumber,
  courtCaseCount: neo4jNumber,
  totalCaseCount: neo4jNumber,
  caseIds: neo4jStringArray,
});

const totalRowSchema = z.object({ total: neo4jNumber });

async function execute(input: Input): Promise<PortfolioExpertsResult> {
  const filterSide = input.side ?? null;

  const baseMatch = `
    MATCH (e:Expert)
    OPTIONAL MATCH (oursCase:Case)-[:OUR_EXPERT]->(e)
    OPTIONAL MATCH (courtCase:Case)-[:COURT_EXPERT]->(e)
    WITH e,
         count(DISTINCT oursCase) AS oursCaseCount,
         count(DISTINCT courtCase) AS courtCaseCount,
         collect(DISTINCT oursCase.caseId) + collect(DISTINCT courtCase.caseId) AS allCaseIds
    WITH e, oursCaseCount, courtCaseCount,
         [cid IN allCaseIds WHERE cid IS NOT NULL] AS caseIds
    WHERE
      ($side IS NULL AND (oursCaseCount > 0 OR courtCaseCount > 0))
      OR ($side = 'ours'  AND oursCaseCount  > 0)
      OR ($side = 'court' AND courtCaseCount > 0)
    WITH e, oursCaseCount, courtCaseCount, caseIds,
         oursCaseCount + courtCaseCount AS totalCaseCount
  `;

  const bucketsCypher = `
    ${baseMatch}
    RETURN e.key AS key,
           e.name AS name,
           e.specialty AS specialty,
           oursCaseCount,
           courtCaseCount,
           totalCaseCount,
           caseIds
    ORDER BY totalCaseCount DESC, name ASC
    LIMIT toInteger($limit)
  `;
  const totalCypher = `${baseMatch} RETURN count(e) AS total`;
  const params = { side: filterSide, limit: input.limit };

  const { rows, meta } = await runReadQueryWithMeta(bucketsCypher, params, rowSchema);
  const totalRows = await runReadQueryWithMeta(totalCypher, params, totalRowSchema);
  const totalMatches = totalRows.rows[0]?.total ?? rows.length;

  return {
    filterSide,
    totalMatches,
    returnedCount: rows.length,
    truncated: rows.length < totalMatches,
    hits: rows,
    meta: { ...meta, rowCount: totalMatches },
  };
}

export const listPortfolioExpertsTool: ToolDefinition<typeof inputSchema, PortfolioExpertsResult> = {
  name: 'listPortfolioExperts',
  label: 'Listing portfolio experts',
  inputSchema,
  execute,
  summarize: (r) => {
    if (r.hits.length === 0) {
      return r.filterSide ? `No ${r.filterSide} experts found` : 'No experts found';
    }
    const sideLabel = r.filterSide ? `${r.filterSide} experts` : 'experts';
    return r.truncated
      ? `${r.returnedCount} of ${r.totalMatches} ${sideLabel}`
      : `${r.returnedCount} ${sideLabel}`;
  },
  extractEvidence: () => [],
  traceMeta: (r) => r.meta,
};
