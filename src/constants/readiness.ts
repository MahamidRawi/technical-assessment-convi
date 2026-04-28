// Tuning thresholds for cohort building and readiness scoring.
// Why these values: DESIGN.md §12.
// Calibrated for the current 70-case dataset: most stages have 3-12 members,
// only case_building and statement_of_defense reach 12+.

export const MIN_COHORT_SIZE = 1;
export const COHORT_CONFIDENCE_HIGH = 12;
export const COHORT_CONFIDENCE_MEDIUM = 6;

// Strong signal tier: frequent cohort patterns. Thresholds are intentionally
// relaxed for this 70-case dataset (most cohorts 3-12 members). Nothing is
// certain; agent must cite cohort size and confidence explicitly.
export const MIN_SIGNAL_SUPPORT = 0.4;
export const MIN_SIGNAL_LIFT = 1.2;
export const TOP_SIGNAL_LIMIT = 12;

// Weak signal tier: sub-threshold patterns surfaced as supplementary evidence.
// Mined alongside strong signals but persisted as a distinct WEAK_SIGNAL
// relationship so the agent can label the confidence explicitly. For small
// cohorts, weak signals often outnumber strong signals — this is expected.
export const WEAK_SIGNAL_SUPPORT = 0.25;
export const WEAK_SIGNAL_LIFT = 1.0;
export const TOP_WEAK_SIGNAL_LIMIT = 12;

export const TOP_SIMILAR_CASE_LIMIT = 8;
export const SIMILARITY_MIN_SCORE = 0.18;

// Minimum activity-log-sourced peers required before we report a transition-
// timing median. Below this, snapshot-only StageEvents (backfilled from
// Case.legalStageEnteredAt) dominate and the aggregate measures case age at
// current-stage entry, not transition duration. See DESIGN.md §8 / §11.
// On the current dataset, very few stages have any activity-log members so
// we keep this low; the snapshot-proxy fallback path surfaces case-age
// statistics with an explicit caveat when activity-log timing is unavailable.
export const MIN_ACTIVITY_LOG_TIMING_MEMBERS = 2;
export const MIN_SNAPSHOT_PROXY_PEERS = 2;

export type ConfidenceBand = 'low' | 'medium' | 'high';

export function cohortConfidenceFor(memberCount: number): ConfidenceBand {
  if (memberCount >= COHORT_CONFIDENCE_HIGH) return 'high';
  if (memberCount >= COHORT_CONFIDENCE_MEDIUM) return 'medium';
  return 'low';
}

// Per-call timing thresholds. For a 70-case dataset, even 'medium' confidence
// is rare. NOTE: timing.ts divides minCohortSize by 2 (high) and 3 (medium).
// Nothing here is certain; agent should cite sample size and caveat results.
export const CONFIDENCE_THRESHOLDS = {
  high: { minCohortSize: 10, minCoverage: 0.6 },
  medium: { minCohortSize: 6, minCoverage: 0.4 },
} as const;
