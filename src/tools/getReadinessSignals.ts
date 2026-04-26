import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jBoolean,
  neo4jNullableNumber,
  neo4jNullableStringArray,
  neo4jNumber,
  neo4jString,
  neo4jStringArray,
} from './_shared/neo4jMap';
import { CaseNotFoundError, resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface ReadinessSignals {
  caseId: string;
  completionRate: number;
  missingCritical: string[];
  isOverdue: boolean | null;
  monthsSinceEvent: number | null;
  daysSinceLastComm: number | null;
  documentCoverage: number;
  coveredCategories: string[];
  meta: QueryMeta;
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
});

type Input = z.infer<typeof inputSchema>;

const rowSchema = z.object({
  caseId: neo4jString,
  completionRate: neo4jNumber,
  missingCritical: neo4jNullableStringArray,
  isOverdue: z.union([neo4jBoolean, z.null()]),
  monthsSinceEvent: neo4jNullableNumber,
  daysSinceLastComm: neo4jNullableNumber,
  categories: neo4jStringArray,
});

async function execute({ caseId }: Input): Promise<ReadinessSignals> {
  const canonicalCaseId = await resolveCaseId(caseId);
  const cypher = `
    MATCH (c:Case {caseId: $caseId})
    OPTIONAL MATCH (c)-[:HAS_COMMUNICATION]->(com:Communication)
    WITH c, max(com.sentAt) AS lastCommRaw
    WITH c, CASE WHEN lastCommRaw IS NULL THEN null ELSE datetime(toString(lastCommRaw)) END AS lastComm
    OPTIONAL MATCH (c)-[:HAS_DOCUMENT]->(:Document)-[:OF_CATEGORY]->(dc:DocumentCategory)
    WITH c, lastComm, collect(DISTINCT dc.name) AS categories
    RETURN c.caseId AS caseId,
           c.completionRate AS completionRate,
           c.missingCritical AS missingCritical,
           c.isOverdue AS isOverdue,
           c.monthsSinceEvent AS monthsSinceEvent,
           CASE WHEN lastComm IS NULL THEN null
                ELSE duration.between(lastComm, datetime()).days END AS daysSinceLastComm,
           categories
  `;
  const { rows, meta } = await runReadQueryWithMeta(cypher, { caseId: canonicalCaseId }, rowSchema);

  if (rows.length === 0) {
    throw new CaseNotFoundError(caseId);
  }

  const [row] = rows;
  if (!row) throw new CaseNotFoundError(caseId);
  const coveredCategories = row.categories.filter((s) => s && s !== 'null');

  return {
    caseId: row.caseId,
    completionRate: row.completionRate,
    missingCritical: row.missingCritical,
    isOverdue: row.isOverdue,
    monthsSinceEvent: row.monthsSinceEvent,
    daysSinceLastComm: row.daysSinceLastComm,
    documentCoverage: coveredCategories.length,
    coveredCategories,
    meta,
  };
}

export const getReadinessSignalsTool: ToolDefinition<typeof inputSchema, ReadinessSignals> = {
  name: 'getReadinessSignals',
  label: 'Fetching auxiliary case metadata',
  inputSchema,
  execute,
  summarize: (r) =>
    `completion=${(r.completionRate * 100).toFixed(0)}%, coverage=${r.documentCoverage} categories, lastComm=${r.daysSinceLastComm ?? 'n/a'}d`,
  extractEvidence: (r) => [
    { sourceType: 'Case', sourceId: r.caseId, label: r.caseId, viaTool: 'getReadinessSignals' },
  ],
  traceMeta: (r) => r.meta,
};
