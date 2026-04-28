import { z } from 'zod';
import { isKnownCaseType } from '@/agents/intentPlanner';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import { neo4jNumber, neo4jString, neo4jStringArray } from './_shared/neo4jMap';
import { resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface SimilarCase {
  caseId: string;
  caseName: string;
  caseType: string;
  legalStage: string;
  score: number;
  reasons: string[];
  overlapSignalKeys: string[];
}

export interface SimilarCaseResult {
  caseId: string;
  hits: SimilarCase[];
  meta: QueryMeta;
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
  targetStage: z
    .string()
    .optional()
    .describe(
      'OMIT unless the user explicitly asks for similar cases that already REACHED a specific stage. Filtering peers by stage requires HAS_STAGE_EVENT history, which is sparse in this dataset and almost always returns 0 hits when set defensively.'
    ),
  limit: z.number().int().min(1).max(20).default(5),
});

const rowSchema = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseType: neo4jString,
  legalStage: neo4jString,
  score: neo4jNumber,
  reasons: neo4jStringArray,
  overlapSignalKeys: neo4jStringArray,
});

async function execute(input: z.infer<typeof inputSchema>): Promise<SimilarCaseResult> {
  if (isKnownCaseType(input.caseId)) {
    throw new Error(
      `findSimilarCases requires a resolved caseId; "${input.caseId}" is a caseType. Use rankSimilarCasePairs for global similarity.`
    );
  }
  const caseId = await resolveCaseId(input.caseId);
  const targetStage = input.targetStage?.trim() ? input.targetStage.trim() : null;
  const cypher = `
    MATCH (:Case {caseId: $caseId})-[rel:SIMILAR_TO]->(peer:Case)
    WHERE $targetStage IS NULL OR EXISTS {
      MATCH (peer)-[:HAS_STAGE_EVENT]->(:StageEvent)-[:FOR_STAGE]->(:Stage {name: $targetStage})
    }
    RETURN peer.caseId AS caseId,
           peer.caseName AS caseName,
           peer.caseType AS caseType,
           peer.legalStage AS legalStage,
           rel.score AS score,
           coalesce(rel.reasons, []) AS reasons,
           coalesce(rel.overlapSignalKeys, []) AS overlapSignalKeys
    ORDER BY rel.score DESC, peer.caseName ASC
    LIMIT toInteger($limit)
  `;
  const { rows, meta } = await runReadQueryWithMeta(
    cypher,
    { caseId, targetStage, limit: input.limit },
    rowSchema
  );
  return { caseId, hits: rows, meta };
}

export const findSimilarCasesTool: ToolDefinition<typeof inputSchema, SimilarCaseResult> = {
  name: 'findSimilarCases',
  label: 'Finding similar cases',
  inputSchema,
  execute,
  summarize: (result) =>
    result.hits.length === 0
      ? 'No similar cases'
      : `${result.hits.length} similar cases, top score ${result.hits[0]?.score.toFixed(2) ?? '0.00'}`,
  extractEvidence: (result) =>
    result.hits.map((hit) => ({
      sourceType: 'Case' as const,
      sourceId: hit.caseId,
      label: hit.caseName,
      viaTool: 'findSimilarCases',
    })),
  traceMeta: (result) => result.meta,
};
