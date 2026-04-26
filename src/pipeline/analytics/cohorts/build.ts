import {
  COHORT_CONFIDENCE_HIGH,
  MIN_ACTIVITY_LOG_TIMING_MEMBERS,
  MIN_COHORT_SIZE,
  MIN_SIGNAL_LIFT,
  MIN_SIGNAL_SUPPORT,
  TOP_SIGNAL_LIMIT,
  cohortConfidenceFor,
} from '@/constants/readiness';
import { median, quantile } from '../stats';
import type {
  CaseInfo,
  CaseSignal,
  CohortInputs,
  CohortWriteSet,
  StageReach,
} from './types';

interface CohortScope {
  scope: 'caseType' | 'global';
  caseType: string | null;
}

interface SignalStat {
  memberHits: number;
  controlHits: number;
  leadDays: number[];
}

function daysBetween(startIso: string, endIso: string): number | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.floor((end - start) / 86_400_000);
}

function cohortKey(
  scope: CohortScope['scope'],
  stageName: string,
  subStage: string | null,
  caseType: string | null
): string {
  return [scope, stageName, subStage ?? '', caseType ?? 'all'].join('|');
}

function uniqueScopes(cases: Map<string, CaseInfo>): CohortScope[] {
  const scopes: CohortScope[] = [{ scope: 'global', caseType: null }];
  for (const value of cases.values()) scopes.push({ scope: 'caseType', caseType: value.caseType });
  return Array.from(
    new Map(scopes.map((scope) => [`${scope.scope}:${scope.caseType ?? 'all'}`, scope])).values()
  );
}

function addMemberSignals(
  stats: Map<string, SignalStat>,
  signals: CaseSignal[],
  occurredAt: string
): void {
  const seen = new Set<string>();
  for (const signal of signals) {
    if (signal.signalKey.startsWith('caseType:')) continue;
    if (!signal.firstObservedAt || signal.firstObservedAt >= occurredAt || seen.has(signal.signalKey)) continue;
    seen.add(signal.signalKey);
    const stat = stats.get(signal.signalKey) ?? { memberHits: 0, controlHits: 0, leadDays: [] };
    stat.memberHits += 1;
    const leadDays = daysBetween(signal.firstObservedAt, occurredAt);
    if (leadDays !== null && leadDays >= 0) stat.leadDays.push(leadDays);
    stats.set(signal.signalKey, stat);
  }
}

function addControlSignals(stats: Map<string, SignalStat>, signals: CaseSignal[]): void {
  const seen = new Set<string>();
  for (const signal of signals) {
    if (signal.signalKey.startsWith('caseType:')) continue;
    if (!signal.firstObservedAt || seen.has(signal.signalKey)) continue;
    seen.add(signal.signalKey);
    const stat = stats.get(signal.signalKey) ?? { memberHits: 0, controlHits: 0, leadDays: [] };
    stat.controlHits += 1;
    stats.set(signal.signalKey, stat);
  }
}

function targetKeys(reaches: StageReach[]): string[] {
  return Array.from(new Set(reaches.map((reach) => `${reach.stageName}|${reach.subStage ?? ''}`)));
}

export function buildCohortWriteSet(inputs: CohortInputs): CohortWriteSet {
  const cohortRows: CohortWriteSet['cohortRows'] = [];
  const memberRows: CohortWriteSet['memberRows'] = [];
  const signalRows: CohortWriteSet['signalRows'] = [];

  for (const scope of uniqueScopes(inputs.cases)) {
    const scopedReaches = inputs.reaches.filter((reach) => scope.scope === 'global' || reach.caseType === scope.caseType);
    for (const targetKey of targetKeys(scopedReaches)) {
      const [stageName = '', subStageValue = ''] = targetKey.split('|');
      if (!stageName) continue;
      const subStage = subStageValue || null;
      const members = scopedReaches.filter((reach) => reach.stageName === stageName && (reach.subStage ?? '') === (subStage ?? ''));
      if (members.length < MIN_COHORT_SIZE) continue;

      const cohortId = cohortKey(scope.scope, stageName, subStage, scope.caseType);
      const memberIds = new Set(members.map((member) => member.caseId));
      const controlCases = Array.from(inputs.cases.values()).filter((caseInfo) => {
        if (scope.scope === 'caseType' && caseInfo.caseType !== scope.caseType) return false;
        return !memberIds.has(caseInfo.caseId);
      });
      const activityLogMembers = members.filter((member) => member.source === 'activity_log');
      const activityLogMemberCount = activityLogMembers.length;
      const snapshotMemberCount = members.length - activityLogMemberCount;

      // Cohort timing is computed only from activity_log-sourced members.
      // current_stage_snapshot members are backfilled from Case.legalStageEnteredAt
      // and measure "days from event to current-stage entry," not transition duration.
      // Mixing them produces a number that looks like a median time-to-stage but
      // isn't. Below MIN_ACTIVITY_LOG_TIMING_MEMBERS we drop the timing claim entirely.
      const activityLogTimingDays = activityLogMembers
        .map((member) => {
          const eventDate = inputs.cases.get(member.caseId)?.eventDate;
          return eventDate ? daysBetween(eventDate, member.occurredAt) : null;
        })
        .filter((value): value is number => value !== null && value >= 0);
      const timingFromActivityLog =
        activityLogTimingDays.length >= MIN_ACTIVITY_LOG_TIMING_MEMBERS;

      const confidence = cohortConfidenceFor(members.length);

      cohortRows.push({
        key: cohortId,
        targetStage: stageName,
        targetSubStage: subStage,
        caseType: scope.caseType,
        scope: scope.scope,
        memberCount: members.length,
        activityLogMemberCount,
        snapshotMemberCount,
        confidence:
          confidence === 'high' && activityLogMemberCount < COHORT_CONFIDENCE_HIGH
            ? 'medium'
            : confidence,
        medianDaysToStage: timingFromActivityLog ? median(activityLogTimingDays) : null,
        daysToStageP25: timingFromActivityLog ? quantile(activityLogTimingDays, 0.25) : null,
        daysToStageP75: timingFromActivityLog ? quantile(activityLogTimingDays, 0.75) : null,
        timingFromActivityLog,
      });
      for (const member of members) memberRows.push({ key: cohortId, caseId: member.caseId });

      const stats = new Map<string, SignalStat>();
      for (const member of members) addMemberSignals(stats, inputs.signalsByCase.get(member.caseId) ?? [], member.occurredAt);
      for (const control of controlCases) addControlSignals(stats, inputs.signalsByCase.get(control.caseId) ?? []);

      const ranked = Array.from(stats.entries())
        .map(([signalKey, stat]) => {
          const support = stat.memberHits / members.length;
          const controlSupport = controlCases.length > 0 ? Math.max(stat.controlHits / controlCases.length, 0.01) : 0.01;
          const lift = support / controlSupport;
          return { signalKey, support, lift, weight: support * Math.log1p(lift), medianLeadDays: median(stat.leadDays) };
        })
        .filter((row) => row.support >= MIN_SIGNAL_SUPPORT && row.lift >= MIN_SIGNAL_LIFT)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, TOP_SIGNAL_LIMIT);

      for (const row of ranked) signalRows.push({ key: cohortId, ...row });
    }
  }

  return { cohortRows, memberRows, signalRows };
}
