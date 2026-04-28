// Internal helper that assembles a ReadinessDecisionArtifact by running the three cohort
// readiness tools in parallel. NOT registered in toolCatalog (the agent calls the three
// atomic tools and the ReadinessArtifactComposer assembles the artifact from observation).
// This function is exported for integration tests that want to exercise the assembled shape
// directly without relying on the composer's internal observation order.
import type { QueryMeta } from './_shared/runReadQueryWithMeta';
import { assertStageExists, resolveCaseId } from './_shared/notFound';
import type { ReadinessDecisionArtifact } from '@/types/trace.types';
import { resolveTargetCase } from './readiness/shared';
import { runCompareCaseToReadinessPattern } from './compareCaseToReadinessPattern';
import { runDeriveReadinessPattern } from './deriveReadinessPattern';
import { runEstimateTimeToStage } from './estimateTimeToStage';

export interface ExplainReadinessDecisionResult {
  artifact: ReadinessDecisionArtifact;
  summary: string;
  meta: QueryMeta;
}

interface ExplainReadinessDecisionInput {
  question: string;
  caseId: string;
  targetStage: string;
  targetSubStage?: string;
}

export async function runExplainReadinessDecision(
  input: ExplainReadinessDecisionInput
): Promise<ExplainReadinessDecisionResult> {
  await assertStageExists(input.targetStage);
  const caseId = await resolveCaseId(input.caseId);
  const targetCase = await resolveTargetCase(caseId);
  const [pattern, comparison, estimate] = await Promise.all([
    runDeriveReadinessPattern({
      caseId,
      targetStage: input.targetStage,
      targetSubStage: input.targetSubStage,
    }),
    runCompareCaseToReadinessPattern({
      caseId,
      targetStage: input.targetStage,
      targetSubStage: input.targetSubStage,
    }),
    runEstimateTimeToStage({
      caseId,
      targetStage: input.targetStage,
      targetSubStage: input.targetSubStage,
    }),
  ]);
  const artifact: ReadinessDecisionArtifact = {
    question: input.question,
    targetCase,
    targetStage: input.targetStage,
    targetSubStage: input.targetSubStage ?? null,
    toolsUsed: [
      'deriveReadinessPattern',
      'compareCaseToReadinessPattern',
      'estimateTimeToStage',
    ],
    availability: estimate.availability,
    cohortAvailable: estimate.cohortAvailable,
    historicalPeerCount: estimate.historicalPeerCount,
    estimationBasis: estimate.estimationBasis,
    cohortSelectionCriteria: pattern.cohortSelectionCriteria,
    cohortSize: pattern.cohortSize,
    cohortMemberCaseIds: pattern.cohortMemberCaseIds,
    observedCommonSignals: pattern.observedCommonSignals,
    observedWeakSignals: pattern.observedWeakSignals,
    matchedSignals: comparison.matchedSignals,
    missingSignals: comparison.missingSignals,
    contextDifferences: comparison.contextDifferences,
    weakMatchedSignals: comparison.weakMatchedSignals,
    weakMissingSignals: comparison.weakMissingSignals,
    timelineEstimate: {
      timingStatus: estimate.timingStatus,
      remainingDaysMedian: estimate.remainingDaysMedian,
      remainingDaysP25: estimate.remainingDaysP25,
      remainingDaysP75: estimate.remainingDaysP75,
      behindByDaysMedian: estimate.behindByDaysMedian,
      behindByDaysP25: estimate.behindByDaysP25,
      behindByDaysP75: estimate.behindByDaysP75,
      snapshotProxyTotalDaysMedian: estimate.snapshotProxyTotalDaysMedian,
      snapshotProxyTotalDaysP25: estimate.snapshotProxyTotalDaysP25,
      snapshotProxyTotalDaysP75: estimate.snapshotProxyTotalDaysP75,
      comparableCaseIds: estimate.comparableCaseIds,
      timingSources: estimate.timingSources,
    },
    confidence: estimate.confidence,
    uncertaintyReasons: Array.from(
      new Set([
        ...pattern.uncertaintyReasons,
        ...comparison.uncertaintyReasons,
        ...estimate.uncertaintyReasons,
      ])
    ),
    optionalPolicyBaselineComparison: null,
  };
  const timingSummary =
    estimate.timingStatus === 'no_estimate'
      ? `no reliable timing estimate; ${estimate.uncertaintyReasons.join('; ')}`
      : estimate.timingStatus === 'behind_historical_trajectory'
        ? `behind historical trajectory by median ${estimate.behindByDaysMedian} days`
        : estimate.timingStatus === 'snapshot_proxy'
          ? `snapshot-proxy median ${estimate.snapshotProxyTotalDaysMedian} days from event to ${input.targetStage} (peer case-age, not transition duration)`
          : `median ${estimate.remainingDaysMedian} days to ${input.targetStage}`;
  const summary = `${comparison.matchedSignals.length} signals matched, ${comparison.missingSignals.length} missing, ${timingSummary}`;
  return { artifact, summary, meta: comparison.meta };
}
