import { z } from 'zod';
import { runReadQuery } from './_shared/runReadQuery';
import {
  neo4jNullableStringArray,
  neo4jNumber,
  neo4jString,
  neo4jStringArray,
} from './_shared/neo4jMap';
import { CaseNotFoundError, resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface CategoryBreakdown {
  category: string;
  count: number;
  examples: Array<{ sourceId: string; fileName: string }>;
}

export interface EvidenceSummary {
  byCategory: CategoryBreakdown[];
  missingCritical: string[];
  coveredCategories: string[];
  completionRate: number;
  signalLabels: string[];
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
});

type Input = z.infer<typeof inputSchema>;

const rowSchema = z.object({
  caseType: neo4jString,
  completionRate: neo4jNumber,
  missingCritical: neo4jNullableStringArray,
  categories: z.array(
    z.union([
      z.object({
        category: neo4jString,
        count: neo4jNumber,
        examples: z.array(
          z.object({
            sourceId: neo4jString,
            fileName: neo4jString,
          })
        ),
      }),
      z.null(),
    ])
  ),
  signalLabels: neo4jStringArray,
});

async function execute({ caseId }: Input): Promise<EvidenceSummary> {
  const canonicalCaseId = await resolveCaseId(caseId);
  const cypher = `
    MATCH (c:Case {caseId: $caseId})
    CALL {
      WITH c
      OPTIONAL MATCH (c)-[:HAS_DOCUMENT]->(d:Document)-[:OF_CATEGORY]->(dc:DocumentCategory)
      WITH dc.name AS category,
           collect(DISTINCT {sourceId: d.sourceId, fileName: d.fileName})[0..3] AS examples,
           count(DISTINCT d) AS n
      RETURN collect(CASE WHEN category IS NULL THEN null ELSE {category: category, count: n, examples: examples} END) AS categories
    }
    CALL {
      WITH c
      OPTIONAL MATCH (c)-[:HAS_SIGNAL]->(rs:ReadinessSignal)
      RETURN [label IN collect(DISTINCT rs.label)[0..12] WHERE label IS NOT NULL] AS signalLabels
    }
    RETURN c.caseType AS caseType,
           c.completionRate AS completionRate,
           c.missingCritical AS missingCritical,
           categories,
           signalLabels
  `;
  const rows = await runReadQuery(cypher, { caseId: canonicalCaseId }, rowSchema);
  if (rows.length === 0) {
    throw new CaseNotFoundError(caseId);
  }

  const [row] = rows;
  if (!row) throw new CaseNotFoundError(caseId);
  const byCategory: CategoryBreakdown[] = row.categories
    .filter(
      (c): c is {
        category: string;
        count: number;
        examples: Array<{ sourceId: string; fileName: string }>;
      } => c !== null
    )
    .map((c) => ({
      category: c.category,
      count: c.count,
      examples: c.examples,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    byCategory,
    missingCritical: row.missingCritical,
    coveredCategories: byCategory.map((c) => c.category),
    completionRate: row.completionRate,
    signalLabels: row.signalLabels,
  };
}

export const getCaseEvidenceTool: ToolDefinition<typeof inputSchema, EvidenceSummary> = {
  name: 'getCaseEvidence',
  label: 'Summarizing evidence',
  inputSchema,
  execute,
  summarize: (r) =>
    `${r.byCategory.length} categories covered, ${r.signalLabels.length} graph signals`,
  extractEvidence: (r) =>
    r.byCategory.flatMap((cat) =>
      cat.examples.map((document) => ({
        sourceType: 'Document' as const,
        sourceId: document.sourceId,
        label: `${cat.category}: ${document.fileName}`,
        viaTool: 'getCaseEvidence',
      }))
    ),
};
