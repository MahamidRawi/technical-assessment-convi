import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignalWriteSet } from '@/pipeline/analytics/signals/build';
import type { SignalObservation } from '@/pipeline/analytics/signals/types';

function scoreKeys(actual: Set<string>, expected: Set<string>): { precision: number; recall: number } {
  const truePositives = Array.from(actual).filter((key) => expected.has(key)).length;
  return {
    precision: truePositives / actual.size,
    recall: truePositives / expected.size,
  };
}

test('readiness signal fixture reaches expected key precision and recall', () => {
  const observations: SignalObservation[] = [
    {
      caseId: 'CASE-1',
      key: 'documentCategory:evidence',
      label: 'Document category: evidence',
      kind: 'documentCategory',
      observedAt: '2024-01-01T00:00:00.000Z',
      sourceKind: 'document',
      emitLabel: 'Document',
      emitSourceId: 'doc-1',
    },
    {
      caseId: 'CASE-1',
      key: 'communicationDirection:incoming',
      label: 'Communication direction: incoming',
      kind: 'communicationDirection',
      observedAt: '2024-01-02T00:00:00.000Z',
      sourceKind: 'communication',
      emitLabel: 'Communication',
      emitSourceId: 'comm-1',
    },
    {
      caseId: 'CASE-1',
      key: 'activity:stage:file_claim',
      label: 'stage: file_claim',
      kind: 'activity',
      observedAt: '2024-01-03T00:00:00.000Z',
      sourceKind: 'activity',
      emitLabel: 'ActivityEvent',
      emitSourceId: 'activity-1',
    },
  ];
  const expected = new Set([
    'documentCategory:evidence',
    'communicationDirection:incoming',
    'activity:stage:file_claim',
  ]);
  const actual = new Set(buildSignalWriteSet(observations).signalDefs.map((signal) => signal.key));

  assert.deepEqual(scoreKeys(actual, expected), { precision: 1, recall: 1 });
});

test('evidence facts emit readiness signals and case-level source kinds', () => {
  const observations: SignalObservation[] = [
    {
      caseId: 'CASE-1',
      key: 'evidenceFactKind:disability_period',
      label: 'Evidence fact: disability_period',
      kind: 'evidenceFactKind',
      observedAt: '2024-01-04T00:00:00.000Z',
      sourceKind: 'evidenceFact',
      emitLabel: 'EvidenceFact',
      emitSourceId: 'fact-1',
    },
    {
      caseId: 'CASE-1',
      key: 'evidenceFactSubtype:disability_period:temporary',
      label: 'Evidence fact: disability_period / temporary',
      kind: 'evidenceFactSubtype',
      observedAt: '2024-01-04T00:00:00.000Z',
      sourceKind: 'evidenceFact',
      emitLabel: 'EvidenceFact',
      emitSourceId: 'fact-1',
    },
  ];

  const writeSet = buildSignalWriteSet(observations);

  assert.deepEqual(
    new Set(writeSet.signalDefs.map((signal) => signal.key)),
    new Set([
      'evidenceFactKind:disability_period',
      'evidenceFactSubtype:disability_period:temporary',
    ])
  );
  assert.deepEqual(writeSet.evidenceFactEmitRows, [
    { sourceId: 'fact-1', signalKey: 'evidenceFactKind:disability_period' },
    { sourceId: 'fact-1', signalKey: 'evidenceFactSubtype:disability_period:temporary' },
  ]);
  assert.equal(writeSet.caseSignalRows.length, 2);
  assert.ok(writeSet.caseSignalRows.every((row) => row.sourceKinds.includes('evidenceFact')));
});
