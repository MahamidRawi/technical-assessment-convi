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
  ];
  const expected = new Set(['documentCategory:evidence', 'communicationDirection:incoming']);
  const actual = new Set(buildSignalWriteSet(observations).signalDefs.map((signal) => signal.key));

  assert.deepEqual(scoreKeys(actual, expected), { precision: 1, recall: 1 });
});
