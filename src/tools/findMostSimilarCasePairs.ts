import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jNullableNumber,
  neo4jNumber,
  neo4jString,
  neo4jStringArray,
} from './_shared/neo4jMap';
import { coerceVocabOrNull, dynamicEnumOptional } from './_shared/dynamicEnums';
import type { ToolDefinition } from './types';

export interface SimilarCaseSummary {
  caseId: string;
  caseName: string;
  caseType: string;
  legalStage: string;
}

export interface MostSimilarCasePair {
  caseA: SimilarCaseSummary;
  caseB: SimilarCaseSummary;
  score: number;
  signalScore: number | null;
  semanticScore: number | null;
  reasons: string[];
  overlapSignalKeys: string[];
}

export interface MostSimilarCasePairsResult {
  status: 'ok' | 'no_similar_edges';
  pairs: MostSimilarCasePair[];
  meta: QueryMeta;
}

/**
 * Factory because `caseType` resolves valid values from the live graph at boot via
 * `loadEnumVocabulary()`. See `_shared/dynamicEnums.ts`.
 */
function buildInputSchema() {
  return z.object({
    caseType: dynamicEnumOptional(
      'caseType',
      'Optional filter on c.caseType (applied to BOTH cases in each pair). OMIT unless the user asks about a specific type.'
    ),
    minScore: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        'Optional minimum SIMILAR_TO score threshold (0..1). OMIT unless the user explicitly wants a quality cutoff.'
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(1)
      .describe(
        'Number of distinct pairs to return. For "the N most similar cases" map N to ceil(N/2) pairs (so "2 most similar cases" = limit:1).'
      ),
  });
}

type InputSchema = ReturnType<typeof buildInputSchema>;
type Input = z.infer<InputSchema>;

const summarySchema = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseType: neo4jString,
  legalStage: neo4jString,
});

const rowSchema = z.object({
  caseA: summarySchema,
  caseB: summarySchema,
  score: neo4jNumber,
  signalScore: neo4jNullableNumber,
  semanticScore: neo4jNullableNumber,
  reasons: neo4jStringArray,
  overlapSignalKeys: neo4jStringArray,
});

async function execute(input: Input): Promise<MostSimilarCasePairsResult> {
  const caseTypeFilter = coerceVocabOrNull('caseType', input.caseType?.trim() || null);
  const minScore = typeof input.minScore === 'number' ? input.minScore : null;
  const params = {
    caseType: caseTypeFilter,
    minScore,
    limit: input.limit,
  };
  const cypher = `
    MATCH (a:Case)-[r:SIMILAR_TO]->(b:Case)
    WHERE a.caseId < b.caseId
      AND ($caseType IS NULL OR (a.caseType = $caseType AND b.caseType = $caseType))
      AND ($minScore IS NULL OR r.score >= $minScore)
    RETURN {
             caseId: a.caseId,
             caseName: a.caseName,
             caseType: a.caseType,
             legalStage: a.legalStage
           } AS caseA,
           {
             caseId: b.caseId,
             caseName: b.caseName,
             caseType: b.caseType,
             legalStage: b.legalStage
           } AS caseB,
           r.score AS score,
           r.signalScore AS signalScore,
           r.semanticScore AS semanticScore,
           coalesce(r.reasons, []) AS reasons,
           coalesce(r.overlapSignalKeys, []) AS overlapSignalKeys
    ORDER BY r.score DESC, a.caseName ASC, b.caseName ASC
    LIMIT toInteger($limit)
  `;
  const { rows, meta } = await runReadQueryWithMeta(cypher, params, rowSchema);
  const pairs: MostSimilarCasePair[] = rows.map((row) => ({
    caseA: row.caseA,
    caseB: row.caseB,
    score: row.score,
    signalScore: row.signalScore,
    semanticScore: row.semanticScore,
    reasons: row.reasons,
    overlapSignalKeys: row.overlapSignalKeys,
  }));
  return {
    status: pairs.length > 0 ? 'ok' : 'no_similar_edges',
    pairs,
    meta,
  };
}

export const findMostSimilarCasePairsTool: ToolDefinition<
  InputSchema,
  MostSimilarCasePairsResult
> = {
  name: 'findMostSimilarCasePairs',
  label: 'Finding most similar case pairs',
  get inputSchema(): InputSchema {
    return buildInputSchema();
  },
  execute,
  summarize: (result) => {
    if (result.status === 'no_similar_edges') {
      return 'No SIMILAR_TO edges found in the graph (or filter excluded all pairs)';
    }
    const top = result.pairs[0];
    return `${result.pairs.length} pair(s); top: ${top?.caseA.caseName} ↔ ${top?.caseB.caseName} @ ${top?.score.toFixed(2) ?? '0.00'}`;
  },
  extractEvidence: (result) =>
    result.pairs.flatMap((pair) => [
      {
        sourceType: 'Case' as const,
        sourceId: pair.caseA.caseId,
        label: pair.caseA.caseName,
        viaTool: 'findMostSimilarCasePairs',
      },
      {
        sourceType: 'Case' as const,
        sourceId: pair.caseB.caseId,
        label: pair.caseB.caseName,
        viaTool: 'findMostSimilarCasePairs',
      },
    ]),
  traceMeta: (result) => result.meta,
};
