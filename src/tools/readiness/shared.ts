import { MIN_COHORT_SIZE, type ConfidenceBand } from '@/constants/readiness';
import type { QueryMeta } from '@/tools/_shared/runReadQueryWithMeta';

export { NoGlobalReadinessCohortError, NoReadinessCohortError } from './errors';
export { resolveTargetCase, countStageReaches } from './targetCase';
export { resolveSelectedCohort, resolveGlobalCohort } from './cohort';

export interface TargetCaseSummary {
  caseId: string;
  caseName: string;
  caseType: string;
  currentStage: string;
  currentSubStage: string | null;
  eventDate: string | null;
}

export interface SelectedCohort {
  key: string;
  scope: 'caseType' | 'global';
  caseType: string | null;
  memberCount: number;
  activityLogMemberCount: number;
  snapshotMemberCount: number;
  confidence: ConfidenceBand;
  targetStage: string;
  targetSubStage: string | null;
  medianDaysToStage: number | null;
  daysToStageP25: number | null;
  daysToStageP75: number | null;
  timingFromActivityLog: boolean;
  cohortSelectionCriteria: string;
  cohortMemberCaseIds: string[];
  selectedCohortScope: 'caseType' | 'global';
  sameTypeMemberCount: number;
  sameTypeThinContextUsed: boolean;
}

export type ReadinessAvailability = 'cohort' | 'sparse_stage' | 'none';
export type ReadinessEstimationBasis =
  | 'cohort_similar_cases'
  | 'stage_timing_fallback'
  | 'none';

export interface StageReachCount {
  targetStage: string;
  targetSubStage: string | null;
  historicalPeerCount: number;
  meta: QueryMeta;
}

const SAME_TYPE_THIN_FLOOR = Math.max(3, Math.ceil(MIN_COHORT_SIZE / 2));

export function thinSameTypeContextUsed(
  scope: 'caseType' | 'global',
  sameTypeMemberCount: number
): boolean {
  return (
    scope === 'global' &&
    sameTypeMemberCount >= SAME_TYPE_THIN_FLOOR &&
    sameTypeMemberCount < MIN_COHORT_SIZE
  );
}

/**
 * Returns the cohort-level uncertainty reasons that should accompany every
 * readiness artifact: same-type widening, and absence of activity-log timing.
 * Centralized so deriveReadinessPattern, compareCaseToReadinessPattern, and
 * estimateTimeToStage stay in sync on the wording.
 */
export function cohortUncertaintyReasons(cohort: SelectedCohort): string[] {
  const reasons: string[] = [];
  if (cohort.sameTypeThinContextUsed) {
    reasons.push(
      `Same-type cohort has only ${cohort.sameTypeMemberCount} cases; widened to global cohort.`
    );
  }
  if (!cohort.timingFromActivityLog) {
    const al = cohort.activityLogMemberCount;
    const snap = cohort.snapshotMemberCount;
    reasons.push(
      `Cohort timing not reported: only ${al} member${al === 1 ? '' : 's'} carry an activity-log stage transition (${snap} are current-stage snapshots backfilled from legalStageEnteredAt). Median/quartile time-to-stage would mix transition timing with case age at current-stage entry.`
    );
  }
  return reasons;
}
