import { z } from 'zod';
import { CASE_TYPE_VALUES } from '@/agents/intentPlanner';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import { neo4jNumber, neo4jString, neo4jStringArray } from './_shared/neo4jMap';
import type { ToolDefinition } from './types';

export interface SimilarCasePair {
  caseIdA: string;
  caseNameA: string;
  caseIdB: string;
  caseNameB: string;
  caseTypeA: string;
  caseTypeB: string;
  score: number;
  reasons: string[];
  overlapSignalKeys: string[];
}

export interface SimilarCasePairsResult {
  caseType: string | null;
  hits: SimilarCasePair[];
  meta: QueryMeta;
}

const inputSchema = z.object({
  caseType: z
    .enum(CASE_TYPE_VALUES)
    .optional()
    .describe('Optional exact caseType filter. Omit for all portfolio pairs.'),
  caseTypes: z
    .array(z.enum(CASE_TYPE_VALUES))
    .optional()
    .describe(
      'Optional set of caseType filters. Use for broader families such as car accidents: ["car_accident_serious","car_accident_minor"].'
    ),
  limit: z.number().int().min(1).max(20).default(5),
});

const rowSchema = z.object({
  caseIdA: neo4jString,
  caseNameA: neo4jString,
  caseIdB: neo4jString,
  caseNameB: neo4jString,
  caseTypeA: neo4jString,
  caseTypeB: neo4jString,
  score: neo4jNumber,
  reasons: neo4jStringArray,
  overlapSignalKeys: neo4jStringArray,
});

async function execute(input: z.infer<typeof inputSchema>): Promise<SimilarCasePairsResult> {
  const caseType = input.caseType?.trim() || null;
  const caseTypes = input.caseTypes && input.caseTypes.length > 0 ? input.caseTypes : null;
  const cypher = `
    MATCH (a:Case)-[rel:SIMILAR_TO]->(b:Case)
    WHERE a.caseId < b.caseId
      AND ($caseType IS NULL OR (a.caseType = $caseType AND b.caseType = $caseType))
      AND ($caseTypes IS NULL OR (a.caseType IN $caseTypes AND b.caseType IN $caseTypes))
    RETURN a.caseId AS caseIdA,
           a.caseName AS caseNameA,
           b.caseId AS caseIdB,
           b.caseName AS caseNameB,
           a.caseType AS caseTypeA,
           b.caseType AS caseTypeB,
           rel.score AS score,
           coalesce(rel.reasons, []) AS reasons,
           coalesce(rel.overlapSignalKeys, []) AS overlapSignalKeys
    ORDER BY rel.score DESC, caseNameA ASC, caseNameB ASC
    LIMIT toInteger($limit)
  `;
  const { rows, meta } = await runReadQueryWithMeta(
    cypher,
    { caseType, caseTypes, limit: input.limit },
    rowSchema
  );
  return { caseType, hits: rows, meta };
}

export const rankSimilarCasePairsTool: ToolDefinition<
  typeof inputSchema,
  SimilarCasePairsResult
> = {
  name: 'rankSimilarCasePairs',
  label: 'Ranking similar case pairs',
  inputSchema,
  execute,
  summarize: (result) =>
    result.hits.length === 0
      ? 'No similar case pairs'
      : `${result.hits.length} similar pairs, top score ${result.hits[0]?.score.toFixed(2) ?? '0.00'}`,
  extractEvidence: (result) =>
    result.hits.flatMap((hit) => [
      {
        sourceType: 'Case' as const,
        sourceId: hit.caseIdA,
        label: hit.caseNameA,
        viaTool: 'rankSimilarCasePairs',
      },
      {
        sourceType: 'Case' as const,
        sourceId: hit.caseIdB,
        label: hit.caseNameB,
        viaTool: 'rankSimilarCasePairs',
      },
    ]),
  traceMeta: (result) => result.meta,
};
