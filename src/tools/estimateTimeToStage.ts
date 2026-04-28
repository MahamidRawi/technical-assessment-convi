import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import { assertStageExists, resolveCaseId } from './_shared/notFound';
import type { ConfidenceBand } from '@/constants/readiness';
import { TOP_SIMILAR_CASE_LIMIT } from '@/constants/readiness';
import type { ToolDefinition } from './types';
import {
  NoReadinessCohortError,
  cohortUncertaintyReasons,
  resolveSelectedCohort,
  type ReadinessAvailability,
  type ReadinessEstimationBasis,
  type TargetCaseSummary,
} from './readiness/shared';
import { weightedMedian } from '@/pipeline/analytics/stats';
import {
  COHORT_TIMING_CYPHER,
  SPARSE_STAGE_TIMING_CYPHER,
  estimateRowSchema,
} from './estimateTimeToStage/cypher';
import {
  confidenceFor,
  summarizePeerTiming,
  type ShapedTiming,
} from './estimateTimeToStage/timing';

export { shapeTimingEstimate } from './estimateTimeToStage/timing';

export interface StageTimeEstimate extends ShapedTiming {
  caseId: string;
  targetStage: string;
  targetSubStage: string | null;
  availability: ReadinessAvailability;
  cohortAvailable: boolean;
  historicalPeerCount: number;
  estimationBasis: ReadinessEstimationBasis;
  cohortKey: string;
  comparableCaseIds: string[];
  timingSources: Array<{ caseId: string; timingSource: string }>;
  confidence: ConfidenceBand;
  uncertaintyReasons: string[];
  meta: QueryMeta;
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
  targetStage: z.string(),
  targetSubStage: z.string().optional(),
});

async function estimateForSparseStage(
  caseId: string,
  targetCase: TargetCaseSummary,
  targetStage: string,
  targetSubStage: string | null
): Promise<StageTimeEstimate> {
  const { rows, meta } = await runReadQueryWithMeta(
    SPARSE_STAGE_TIMING_CYPHER,
    { caseId, targetStage, limit: TOP_SIMILAR_CASE_LIMIT },
    estimateRowSchema
  );
  const peerCount = rows.length;
  const summary = summarizePeerTiming(rows, targetCase);
  const reasonSuffix =
    peerCount > 0
      ? `; only ${peerCount} timed historical peer${peerCount === 1 ? '' : 's'} reached the stage.`
      : `, and no timed historical peer reached the stage.`;
  const basis: ReadinessEstimationBasis =
    summary.shaped.timingStatus === 'snapshot_proxy'
      ? 'snapshot_proxy'
      : peerCount > 0
        ? 'stage_timing_fallback'
        : 'none';
  return {
    caseId,
    targetStage,
    targetSubStage,
    availability: peerCount > 0 ? 'sparse_stage' : 'none',
    cohortAvailable: false,
    historicalPeerCount: peerCount,
    estimationBasis: basis,
    cohortKey: '',
    comparableCaseIds: summary.comparableCaseIds,
    timingSources: summary.timingSources,
    ...summary.shaped,
    confidence: 'low',
    uncertaintyReasons: [
      `No readiness cohort exists for ${targetStage}${reasonSuffix}`,
      ...summary.uncertaintyReasons,
    ],
    meta,
  };
}

async function estimateForCohort(
  caseId: string,
  selected: Awaited<ReturnType<typeof resolveSelectedCohort>>,
  targetStage: string,
  targetSubStage: string | null
): Promise<StageTimeEstimate> {
  const { targetCase, cohort } = selected;
  const { rows, meta } = await runReadQueryWithMeta(
    COHORT_TIMING_CYPHER,
    {
      caseId,
      cohortKey: cohort.key,
      targetStage,
      targetSubStage,
      limit: TOP_SIMILAR_CASE_LIMIT,
    },
    estimateRowSchema
  );
  const summary = summarizePeerTiming(rows, targetCase);
  // Confidence is anchored to activity-log peers — snapshot peers don't measure
  // a transition. Counting them inflates the band.
  const timedCount = rows.filter(
    (row) => row.totalDaysToStage !== null && row.timingSource === 'activity_log'
  ).length;
  const medianScore =
    rows.length === 0
      ? null
      : weightedMedian(rows.map((row) => ({ value: row.similarityScore, weight: 1 })));
  const cohortReasons = cohortUncertaintyReasons(cohort);
  return {
    caseId,
    targetStage,
    targetSubStage,
    availability: 'cohort',
    cohortAvailable: true,
    historicalPeerCount: cohort.memberCount,
    estimationBasis: 'cohort_similar_cases',
    cohortKey: cohort.key,
    comparableCaseIds: summary.comparableCaseIds,
    timingSources: summary.timingSources,
    ...summary.shaped,
    confidence: confidenceFor(timedCount, medianScore),
    uncertaintyReasons: [...cohortReasons, ...summary.uncertaintyReasons],
    meta,
  };
}

export async function runEstimateTimeToStage(
  input: z.infer<typeof inputSchema>
): Promise<StageTimeEstimate> {
  const caseId = await resolveCaseId(input.caseId);
  await assertStageExists(input.targetStage);
  const targetSubStage = input.targetSubStage ?? null;
  try {
    const selected = await resolveSelectedCohort(caseId, input.targetStage, targetSubStage);
    return await estimateForCohort(caseId, selected, input.targetStage, targetSubStage);
  } catch (error: unknown) {
    if (error instanceof NoReadinessCohortError) {
      return estimateForSparseStage(caseId, error.targetCase, input.targetStage, targetSubStage);
    }
    throw error;
  }
}

function summarize(result: StageTimeEstimate): string {
  if (result.timingStatus === 'no_estimate') {
    return `No reliable timing estimate (${result.availability}, ${result.uncertaintyReasons.join('; ')})`;
  }
  if (result.timingStatus === 'behind_historical_trajectory') {
    return `${result.estimationBasis}: behind historical trajectory by median ${result.behindByDaysMedian} days for ${result.targetStage}`;
  }
  if (result.timingStatus === 'snapshot_proxy') {
    return `${result.estimationBasis}: snapshot-proxy median ${result.snapshotProxyTotalDaysMedian} days from event to ${result.targetStage} (peer case-age, not transition duration)`;
  }
  return `${result.estimationBasis}: median ${result.remainingDaysMedian} days to ${result.targetStage}`;
}

export const estimateTimeToStageTool: ToolDefinition<typeof inputSchema, StageTimeEstimate> = {
  name: 'estimateTimeToStage',
  label: 'Estimating time to stage',
  inputSchema,
  execute: runEstimateTimeToStage,
  summarize,
  extractEvidence: (result) =>
    result.comparableCaseIds.map((caseId) => ({
      sourceType: 'Case' as const,
      sourceId: caseId,
      label: `timing peer ${caseId}`,
      viaTool: 'estimateTimeToStage',
    })),
  traceMeta: (result) => result.meta,
};
