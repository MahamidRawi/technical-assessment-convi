import { z } from 'zod';
import { CASE_TYPE_VALUES } from '@/agents/intentPlanner';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import { neo4jNumber, neo4jString, neo4jStringArray } from './_shared/neo4jMap';
import { resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface ObservedStageTransition {
  fromStage: string;
  toStage: string;
  caseCount: number;
  exampleCaseIds: string[];
}

export interface ObservedStageTransitionsResult {
  currentStage: string;
  seedCaseId: string | null;
  caseType: string | null;
  status: 'observed' | 'no_observed_transitions';
  observedNextStages: ObservedStageTransition[];
  caveat: string | null;
  meta: QueryMeta;
}

const inputSchema = z.object({
  currentStage: z.string().describe('Exact current stage name, usually from getStageTimeline.currentStage.'),
  seedCaseId: z
    .string()
    .optional()
    .describe('Optional canonical caseId/Mongo id/sourceId. Used only to infer caseType when caseType is omitted.'),
  caseType: z
    .enum(CASE_TYPE_VALUES)
    .optional()
    .describe('Optional exact caseType filter for peer transitions.'),
  limit: z.number().int().min(1).max(20).default(5),
});

const rowSchema = z.object({
  fromStage: neo4jString,
  toStage: neo4jString,
  caseCount: neo4jNumber,
  exampleCaseIds: neo4jStringArray,
});

const caseTypeRowSchema = z.object({ caseType: neo4jString });

async function inferCaseType(seedCaseId: string | undefined): Promise<{
  seedCaseId: string | null;
  caseType: string | null;
}> {
  if (!seedCaseId?.trim()) return { seedCaseId: null, caseType: null };
  const canonicalCaseId = await resolveCaseId(seedCaseId);
  const { rows } = await runReadQueryWithMeta(
    'MATCH (c:Case {caseId: $caseId}) RETURN c.caseType AS caseType',
    { caseId: canonicalCaseId },
    caseTypeRowSchema
  );
  return { seedCaseId: canonicalCaseId, caseType: rows[0]?.caseType ?? null };
}

async function execute(
  input: z.infer<typeof inputSchema>
): Promise<ObservedStageTransitionsResult> {
  const currentStage = input.currentStage.trim();
  const inferred = await inferCaseType(input.seedCaseId);
  const caseType = input.caseType ?? inferred.caseType;
  const cypher = `
    MATCH (c:Case)
    WHERE ($caseType IS NULL OR c.caseType = $caseType)
    MATCH (c)-[fromRel:REACHED_STAGE]->(from:Stage {name: $currentStage})
    MATCH (c)-[toRel:REACHED_STAGE]->(to:Stage)
    WHERE fromRel.at IS NOT NULL
      AND toRel.at IS NOT NULL
      AND toRel.at > fromRel.at
    WITH c, from, to, toRel
    ORDER BY c.caseId ASC, toRel.at ASC
    WITH c, from, collect({stage: to.name, at: toRel.at})[0] AS next
    WHERE next.stage IS NOT NULL
    RETURN from.name AS fromStage,
           next.stage AS toStage,
           count(DISTINCT c) AS caseCount,
           collect(DISTINCT c.caseId)[0..5] AS exampleCaseIds
    ORDER BY caseCount DESC, toStage ASC
    LIMIT toInteger($limit)
  `;
  const { rows, meta } = await runReadQueryWithMeta(
    cypher,
    { currentStage, caseType, limit: input.limit },
    rowSchema
  );

  return {
    currentStage,
    seedCaseId: inferred.seedCaseId,
    caseType,
    status: rows.length > 0 ? 'observed' : 'no_observed_transitions',
    observedNextStages: rows,
    caveat:
      rows.length > 0
        ? null
        : 'No ordered historical transitions were found from this stage. Known stage taxonomy is not evidence of next-stage progression.',
    meta,
  };
}

export const getObservedStageTransitionsTool: ToolDefinition<
  typeof inputSchema,
  ObservedStageTransitionsResult
> = {
  name: 'getObservedStageTransitions',
  label: 'Finding observed stage transitions',
  inputSchema,
  execute,
  summarize: (result) =>
    result.status === 'observed'
      ? `${result.observedNextStages.length} observed next-stage bucket(s) from ${result.currentStage}`
      : `No observed transitions from ${result.currentStage}`,
  extractEvidence: (result) =>
    result.observedNextStages.flatMap((stage) =>
      stage.exampleCaseIds.map((caseId) => ({
        sourceType: 'Case' as const,
        sourceId: caseId,
        label: `${stage.fromStage} -> ${stage.toStage}`,
        viaTool: 'getObservedStageTransitions',
      }))
    ),
  traceMeta: (result) => result.meta,
};
