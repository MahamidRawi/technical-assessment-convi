// Tuning thresholds for cohort building and readiness scoring.
// Why these values: DESIGN.md §12.

export const MIN_COHORT_SIZE = 5;
export const COHORT_CONFIDENCE_HIGH = 25;
export const COHORT_CONFIDENCE_MEDIUM = 12;

export const MIN_SIGNAL_SUPPORT = 0.6;
export const MIN_SIGNAL_LIFT = 1.5;
export const TOP_SIGNAL_LIMIT = 12;

export const TOP_SIMILAR_CASE_LIMIT = 8;
export const SIMILARITY_MIN_SCORE = 0.18;

// Minimum activity-log-sourced peers required before we report a timing median
// or quartiles. Below this, snapshot-only StageEvents (backfilled from
// Case.legalStageEnteredAt) dominate and the aggregate measures "case age at
// current-stage entry," not transition duration. See DESIGN.md §8 / §11.
export const MIN_ACTIVITY_LOG_TIMING_MEMBERS = 3;

export type ConfidenceBand = 'low' | 'medium' | 'high';

export function cohortConfidenceFor(memberCount: number): ConfidenceBand {
  if (memberCount >= COHORT_CONFIDENCE_HIGH) return 'high';
  if (memberCount >= COHORT_CONFIDENCE_MEDIUM) return 'medium';
  return 'low';
}

// Per-call timing thresholds. NOTE: timing.ts divides minCohortSize by 2 (high)
// and 3 (medium), so high.minCohortSize=20 needs peerCount>=10 — but
// TOP_SIMILAR_CASE_LIMIT caps that at 8. Timing tool can't return 'high' today.
export const CONFIDENCE_THRESHOLDS = {
  high: { minCohortSize: 20, minCoverage: 0.75 },
  medium: { minCohortSize: 12, minCoverage: 0.45 },
} as const;
