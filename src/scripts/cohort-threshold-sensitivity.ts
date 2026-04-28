import 'dotenv/config';
import { connectNeo4j, closeNeo4j, createSession } from '../db/neo4j';
import { loadCohortInputs } from '../pipeline/analytics/cohorts/extract';
import { median } from '../pipeline/analytics/stats';
import {
  MIN_COHORT_SIZE,
  MIN_SIGNAL_SUPPORT,
  MIN_SIGNAL_LIFT,
} from '../constants/readiness';
import type { CaseInfo, CaseSignal, StageReach } from '../pipeline/analytics/cohorts/types';

interface UnfilteredSignal {
  signalKey: string;
  support: number;
  lift: number;
  weight: number;
  medianLeadDays: number | null;
}

interface CohortStats {
  scope: 'caseType' | 'global';
  caseType: string | null;
  stageName: string;
  subStage: string | null;
  members: number;
  signals: UnfilteredSignal[];
}

interface CohortScope {
  scope: 'caseType' | 'global';
  caseType: string | null;
}

interface SignalStat {
  memberHits: number;
  controlHits: number;
  leadDays: number[];
}

const SUPPORT_BINS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const LIFT_BINS = [1.0, 1.2, 1.5, 2.0, 3.0];

function daysBetween(startIso: string, endIso: string): number | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.floor((end - start) / 86_400_000);
}

function uniqueScopes(cases: Map<string, CaseInfo>): CohortScope[] {
  const scopes: CohortScope[] = [{ scope: 'global', caseType: null }];
  for (const value of cases.values()) scopes.push({ scope: 'caseType', caseType: value.caseType });
  return Array.from(
    new Map(scopes.map((scope) => [`${scope.scope}:${scope.caseType ?? 'all'}`, scope])).values()
  );
}

function targetKeys(reaches: StageReach[]): string[] {
  return Array.from(new Set(reaches.map((reach) => `${reach.stageName}|${reach.subStage ?? ''}`)));
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

function unfilteredSignals(
  stats: Map<string, SignalStat>,
  memberCount: number,
  controlCount: number
): UnfilteredSignal[] {
  return Array.from(stats.entries())
    .map(([signalKey, stat]) => {
      const support = stat.memberHits / memberCount;
      const controlSupport = controlCount > 0 ? Math.max(stat.controlHits / controlCount, 0.01) : 0.01;
      const lift = support / controlSupport;
      return {
        signalKey,
        support,
        lift,
        weight: support * Math.log1p(lift),
        medianLeadDays: median(stat.leadDays),
      };
    })
    .sort((a, b) => b.weight - a.weight);
}

function bin(values: number[], thresholds: number[]): number[] {
  return thresholds.map((t) => values.filter((v) => v >= t).length);
}

async function collectCohortStats(): Promise<CohortStats[]> {
  await connectNeo4j();
  const session = createSession();
  try {
    const inputs = await loadCohortInputs(session);
    const out: CohortStats[] = [];

    for (const scope of uniqueScopes(inputs.cases)) {
      const scopedReaches = inputs.reaches.filter(
        (reach) => scope.scope === 'global' || reach.caseType === scope.caseType
      );
      for (const targetKey of targetKeys(scopedReaches)) {
        const [stageName = '', subStageValue = ''] = targetKey.split('|');
        if (!stageName) continue;
        const subStage = subStageValue || null;
        const members = scopedReaches.filter(
          (reach) => reach.stageName === stageName && (reach.subStage ?? '') === (subStage ?? '')
        );
        if (members.length < MIN_COHORT_SIZE) continue;

        const memberIds = new Set(members.map((member) => member.caseId));
        const controls = Array.from(inputs.cases.values()).filter((caseInfo) => {
          if (scope.scope === 'caseType' && caseInfo.caseType !== scope.caseType) return false;
          return !memberIds.has(caseInfo.caseId);
        });

        const stats = new Map<string, SignalStat>();
        for (const member of members) {
          addMemberSignals(stats, inputs.signalsByCase.get(member.caseId) ?? [], member.occurredAt);
        }
        for (const control of controls) {
          addControlSignals(stats, inputs.signalsByCase.get(control.caseId) ?? []);
        }

        out.push({
          scope: scope.scope,
          caseType: scope.caseType,
          stageName,
          subStage,
          members: members.length,
          signals: unfilteredSignals(stats, members.length, controls.length),
        });
      }
    }
    return out;
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

function printHistogram(cohort: CohortStats): void {
  const supports = cohort.signals.map((s) => s.support);
  const lifts = cohort.signals.map((s) => s.lift);
  const supportBins = bin(supports, SUPPORT_BINS);
  const liftBins = bin(lifts, LIFT_BINS);
  const supportLine = SUPPORT_BINS.map((t, i) => `≥${t}:${supportBins[i]}`).join(' ');
  const liftLine = LIFT_BINS.map((t, i) => `≥${t}:${liftBins[i]}`).join(' ');

  const passingCurrent = cohort.signals.filter(
    (s) => s.support >= MIN_SIGNAL_SUPPORT && s.lift >= MIN_SIGNAL_LIFT
  ).length;
  const weakWouldUnlock = cohort.signals.filter(
    (s) =>
      s.support >= 0.4 &&
      s.support < MIN_SIGNAL_SUPPORT &&
      s.lift >= 1.2
  ).length;

  const scopeLabel = cohort.scope === 'global' ? 'global' : `caseType=${cohort.caseType}`;
  const subLabel = cohort.subStage ? `/${cohort.subStage}` : '';
  console.log(`\n${cohort.stageName}${subLabel} | ${scopeLabel} | members=${cohort.members} | total signals=${cohort.signals.length}`);
  console.log(`  support tiers: ${supportLine}`);
  console.log(`  lift tiers:    ${liftLine}`);
  console.log(`  passing CURRENT thresholds (support≥${MIN_SIGNAL_SUPPORT} & lift≥${MIN_SIGNAL_LIFT}): ${passingCurrent}`);
  console.log(`  would unlock at WEAK tier (support 0.4–${MIN_SIGNAL_SUPPORT}, lift≥1.2): ${weakWouldUnlock}`);

  const top = cohort.signals.slice(0, 5);
  if (top.length > 0) {
    console.log(`  top 5 signals by weight:`);
    for (const s of top) {
      console.log(
        `    ${s.signalKey} | support=${s.support.toFixed(3)} | lift=${s.lift.toFixed(2)} | weight=${s.weight.toFixed(3)}`
      );
    }
  }
}

async function main(): Promise<void> {
  const cohorts = await collectCohortStats();
  if (cohorts.length === 0) {
    console.log('No cohorts (no stage has >= MIN_COHORT_SIZE members).');
    return;
  }

  console.log(`Sensitivity report across ${cohorts.length} cohorts.`);
  console.log(`Current thresholds: MIN_SIGNAL_SUPPORT=${MIN_SIGNAL_SUPPORT}, MIN_SIGNAL_LIFT=${MIN_SIGNAL_LIFT}`);

  for (const cohort of cohorts) printHistogram(cohort);

  const summary = cohorts.map((c) => ({
    stage: c.stageName,
    scope: c.scope,
    caseType: c.caseType,
    members: c.members,
    currentPassing: c.signals.filter((s) => s.support >= MIN_SIGNAL_SUPPORT && s.lift >= MIN_SIGNAL_LIFT).length,
    weakUnlock: c.signals.filter((s) => s.support >= 0.4 && s.support < MIN_SIGNAL_SUPPORT && s.lift >= 1.2).length,
  }));
  console.log('\nSummary (cohorts where WEAK tier would unlock signal yield):');
  for (const row of summary.filter((r) => r.currentPassing === 0 && r.weakUnlock > 0)) {
    console.log(
      `  ${row.stage} | ${row.scope}${row.caseType ? `:${row.caseType}` : ''} | members=${row.members} | current=0, weak=${row.weakUnlock}`
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
