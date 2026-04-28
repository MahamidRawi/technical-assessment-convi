import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCohortWriteSet } from '@/pipeline/analytics/cohorts/build';
import type { CohortInputs } from '@/pipeline/analytics/cohorts/types';
import { thinSameTypeContextUsed } from '@/tools/readiness/shared';

function addDays(baseIso: string, days: number): string {
  const date = new Date(baseIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function fixtureInputs({ includeSignals }: { includeSignals: boolean }): CohortInputs {
  const cases = new Map();
  const reaches = [];
  const signalsByCase = new Map();
  const eventDate = '2024-01-01T00:00:00.000Z';
  const reachedAt = addDays(eventDate, 100);
  const signalAt = addDays(eventDate, 90);

  for (let index = 1; index <= 12; index += 1) {
    const caseId = `M${index}`;
    cases.set(caseId, { caseId, caseType: 'work_accident', eventDate });
    reaches.push({
      caseId,
      caseType: 'work_accident',
      stageName: 'file_claim',
      subStage: null,
      occurredAt: reachedAt,
      source: 'activity_log',
    });
    if (includeSignals && index <= 8) {
      signalsByCase.set(caseId, [{ signalKey: 'documentCategory:evidence', firstObservedAt: signalAt }]);
    }
  }

  for (let index = 1; index <= 12; index += 1) {
    const caseId = `C${index}`;
    cases.set(caseId, { caseId, caseType: 'work_accident', eventDate });
    if (includeSignals && index === 1) {
      signalsByCase.set(caseId, [{ signalKey: 'documentCategory:evidence', firstObservedAt: signalAt }]);
    }
  }

  return { cases, reaches, signalsByCase };
}

test('buildCohortWriteSet computes support, lift, weight, timing, and controls', () => {
  const writeSet = buildCohortWriteSet(fixtureInputs({ includeSignals: true }));
  const cohort = writeSet.cohortRows.find(
    (row) => row.scope === 'caseType' && row.caseType === 'work_accident'
  );
  const signal = writeSet.signalRows.find(
    (row) => row.key === cohort?.key && row.signalKey === 'documentCategory:evidence'
  );

  assert.ok(cohort);
  assert.equal(cohort.memberCount, 12);
  assert.equal(cohort.activityLogMemberCount, 12);
  assert.equal(cohort.snapshotMemberCount, 0);
  assert.equal(cohort.timingFromActivityLog, true);
  assert.equal(cohort.medianDaysToStage, 100);
  assert.equal(cohort.daysToStageP25, 100);
  assert.equal(cohort.daysToStageP75, 100);
  assert.equal(writeSet.memberRows.filter((row) => row.key === cohort.key).length, 12);
  assert.ok(signal);
  assert.equal(signal.support, 8 / 12);
  assert.equal(signal.lift, 8);
  assert.equal(signal.medianLeadDays, 10);
  assert.ok(Math.abs(signal.weight - ((8 / 12) * Math.log1p(8))) < 0.000001);
});

test('buildCohortWriteSet drops timing when cohort is all snapshot members', () => {
  const inputs = fixtureInputs({ includeSignals: false });
  for (const reach of inputs.reaches) reach.source = 'current_stage_snapshot';

  const writeSet = buildCohortWriteSet(inputs);
  const cohort = writeSet.cohortRows.find(
    (row) => row.scope === 'caseType' && row.caseType === 'work_accident'
  );

  assert.ok(cohort);
  assert.equal(cohort.memberCount, 12);
  assert.equal(cohort.activityLogMemberCount, 0);
  assert.equal(cohort.snapshotMemberCount, 12);
  assert.equal(cohort.timingFromActivityLog, false);
  assert.equal(cohort.medianDaysToStage, null);
  assert.equal(cohort.daysToStageP25, null);
  assert.equal(cohort.daysToStageP75, null);
});

test('buildCohortWriteSet drops timing when activity-log members are below the floor', () => {
  const inputs = fixtureInputs({ includeSignals: false });
  // One activity-log member, eleven snapshot members — below the 2-peer minimum.
  inputs.reaches.forEach((reach, index) => {
    reach.source = index < 1 ? 'activity_log' : 'current_stage_snapshot';
  });

  const writeSet = buildCohortWriteSet(inputs);
  const cohort = writeSet.cohortRows.find(
    (row) => row.scope === 'caseType' && row.caseType === 'work_accident'
  );

  assert.ok(cohort);
  assert.equal(cohort.activityLogMemberCount, 1);
  assert.equal(cohort.snapshotMemberCount, 11);
  assert.equal(cohort.timingFromActivityLog, false);
  assert.equal(cohort.medianDaysToStage, null);
});

test('buildCohortWriteSet keeps timing once activity-log members hit the floor', () => {
  const inputs = fixtureInputs({ includeSignals: false });
  inputs.reaches.forEach((reach, index) => {
    reach.source = index < 2 ? 'activity_log' : 'current_stage_snapshot';
  });

  const writeSet = buildCohortWriteSet(inputs);
  const cohort = writeSet.cohortRows.find(
    (row) => row.scope === 'caseType' && row.caseType === 'work_accident'
  );

  assert.ok(cohort);
  assert.equal(cohort.activityLogMemberCount, 2);
  assert.equal(cohort.snapshotMemberCount, 10);
  assert.equal(cohort.timingFromActivityLog, true);
  assert.equal(cohort.medianDaysToStage, 100);
});

test('buildCohortWriteSet emits cohorts without common signals when no signals qualify', () => {
  const writeSet = buildCohortWriteSet(fixtureInputs({ includeSignals: false }));
  assert.ok(writeSet.cohortRows.some((row) => row.scope === 'caseType'));
  assert.equal(writeSet.signalRows.length, 0);
});

test('buildCohortWriteSet keeps context signals but excludes caseType as a readiness requirement', () => {
  const inputs = fixtureInputs({ includeSignals: false });
  for (const reach of inputs.reaches) {
    const existing = inputs.signalsByCase.get(reach.caseId) ?? [];
    existing.push(
      { signalKey: 'caseType:work_accident', firstObservedAt: '2024-01-01T00:00:00.000Z' },
      { signalKey: 'injury:neck', firstObservedAt: '2024-01-01T00:00:00.000Z' }
    );
    inputs.signalsByCase.set(reach.caseId, existing);
  }

  const writeSet = buildCohortWriteSet(inputs);
  assert.ok(writeSet.signalRows.some((row) => row.signalKey === 'injury:neck'));
  assert.equal(writeSet.signalRows.some((row) => row.signalKey.startsWith('caseType:')), false);
});

test('thinSameTypeContextUsed labels [floor, MIN_COHORT_SIZE) same-type members behind a global cohort', () => {
  // With MIN_COHORT_SIZE = 3 the thin interval is [2, 3); a same-type cohort with 3+
  // members forms its own cohort and is not "thin", and < 2 is too sparse to mention.
  assert.equal(thinSameTypeContextUsed('global', 2), true);
  assert.equal(thinSameTypeContextUsed('global', 3), false);
  assert.equal(thinSameTypeContextUsed('global', 4), false);
  assert.equal(thinSameTypeContextUsed('global', 1), false);
  assert.equal(thinSameTypeContextUsed('caseType', 2), false);
});
