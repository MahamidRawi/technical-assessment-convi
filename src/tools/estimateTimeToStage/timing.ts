import type { ConfidenceBand } from '@/constants/readiness';
import {
  CONFIDENCE_THRESHOLDS,
  MIN_ACTIVITY_LOG_TIMING_MEMBERS,
} from '@/constants/readiness';
import { weightedMedian, weightedQuantile } from '@/pipeline/analytics/stats';
import type { TargetCaseSummary } from '../readiness/shared';
import type { EstimateRow } from './cypher';

export interface ShapedTiming {
  timingStatus: 'no_estimate' | 'future_estimate' | 'behind_historical_trajectory';
  remainingDaysMedian: number | null;
  remainingDaysP25: number | null;
  remainingDaysP75: number | null;
  behindByDaysMedian: number | null;
  behindByDaysP25: number | null;
  behindByDaysP75: number | null;
}

const NO_TIMING: ShapedTiming = {
  timingStatus: 'no_estimate',
  remainingDaysMedian: null,
  remainingDaysP25: null,
  remainingDaysP75: null,
  behindByDaysMedian: null,
  behindByDaysP25: null,
  behindByDaysP75: null,
};

function nonNegative(value: number | null): number | null {
  return value !== null && value >= 0 ? value : null;
}

function negativeLag(value: number | null): number | null {
  return value !== null && value < 0 ? Math.abs(value) : null;
}

export function currentAgeDays(targetCase: TargetCaseSummary): number | null {
  if (!targetCase.eventDate) return null;
  const eventMs = new Date(targetCase.eventDate).getTime();
  if (Number.isNaN(eventMs)) return null;
  return Math.floor((Date.now() - eventMs) / 86_400_000);
}

export function confidenceFor(peerCount: number, medianScore: number | null): ConfidenceBand {
  const score = medianScore ?? 0;
  if (
    peerCount >= CONFIDENCE_THRESHOLDS.high.minCohortSize / 2 &&
    score >= CONFIDENCE_THRESHOLDS.high.minCoverage / 2
  ) {
    return 'high';
  }
  if (
    peerCount >= CONFIDENCE_THRESHOLDS.medium.minCohortSize / 3 &&
    score >= CONFIDENCE_THRESHOLDS.medium.minCoverage / 2
  ) {
    return 'medium';
  }
  return 'low';
}

export function shapeTimingEstimate(raw: {
  median: number | null;
  p25: number | null;
  p75: number | null;
}): ShapedTiming {
  if (raw.median === null) return NO_TIMING;
  if (raw.median < 0) {
    return {
      timingStatus: 'behind_historical_trajectory',
      remainingDaysMedian: null,
      remainingDaysP25: null,
      remainingDaysP75: null,
      behindByDaysMedian: Math.abs(raw.median),
      behindByDaysP25: negativeLag(raw.p25),
      behindByDaysP75: negativeLag(raw.p75),
    };
  }
  return {
    timingStatus: 'future_estimate',
    remainingDaysMedian: raw.median,
    remainingDaysP25: nonNegative(raw.p25),
    remainingDaysP75: nonNegative(raw.p75),
    behindByDaysMedian: null,
    behindByDaysP25: null,
    behindByDaysP75: null,
  };
}

export interface PeerTimingSummary {
  shaped: ShapedTiming;
  comparableCaseIds: string[];
  timingSources: Array<{ caseId: string; timingSource: string }>;
  uncertaintyReasons: string[];
}

export function summarizePeerTiming(
  rows: EstimateRow[],
  targetCase: TargetCaseSummary
): PeerTimingSummary {
  const ageDays = currentAgeDays(targetCase);
  // Only activity-log peers carry transition timing; current_stage_snapshot peers
  // measure case age at current-stage entry. Mixing them produces a meaningless
  // median. Below MIN_ACTIVITY_LOG_TIMING_MEMBERS we report no estimate.
  const activityLogRows = rows.filter((row) => row.timingSource === 'activity_log');
  const enoughActivityLog = activityLogRows.length >= MIN_ACTIVITY_LOG_TIMING_MEMBERS;
  const weightedRows =
    ageDays === null || !enoughActivityLog
      ? []
      : activityLogRows
          .filter((row) => row.totalDaysToStage !== null)
          .map((row) => ({
            value: (row.totalDaysToStage ?? 0) - ageDays,
            weight: Math.max(row.similarityScore, 0.05),
          }));

  const uncertaintyReasons: string[] = [];
  if (!targetCase.eventDate) uncertaintyReasons.push('Target case has no eventDate');
  if (!enoughActivityLog) {
    const al = activityLogRows.length;
    const snap = rows.length - al;
    uncertaintyReasons.push(
      `Timing not estimated: ${al} activity-log peer${al === 1 ? '' : 's'} below the ${MIN_ACTIVITY_LOG_TIMING_MEMBERS}-peer minimum (${snap} additional peer${snap === 1 ? ' carries' : 's carry'} only a current-stage snapshot, which measures case age at stage entry — not transition duration).`
    );
  } else if (weightedRows.length === 0) {
    uncertaintyReasons.push('No comparable historical cases with eventDate and target-stage timing');
  }

  return {
    shaped: shapeTimingEstimate({
      median: weightedMedian(weightedRows),
      p25: weightedQuantile(weightedRows, 0.25),
      p75: weightedQuantile(weightedRows, 0.75),
    }),
    comparableCaseIds: rows.map((row) => row.peerCaseId),
    timingSources: rows.map((row) => ({
      caseId: row.peerCaseId,
      timingSource: row.timingSource,
    })),
    uncertaintyReasons,
  };
}
