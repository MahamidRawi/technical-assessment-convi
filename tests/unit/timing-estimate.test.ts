import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeTimingEstimate } from '@/tools/estimateTimeToStage';

test('shapeTimingEstimate converts missing timing to no_estimate', () => {
  assert.deepEqual(shapeTimingEstimate({ median: null, p25: null, p75: null }), {
    timingStatus: 'no_estimate',
    remainingDaysMedian: null,
    remainingDaysP25: null,
    remainingDaysP75: null,
    behindByDaysMedian: null,
    behindByDaysP25: null,
    behindByDaysP75: null,
    snapshotProxyTotalDaysMedian: null,
    snapshotProxyTotalDaysP25: null,
    snapshotProxyTotalDaysP75: null,
  });
});

test('shapeTimingEstimate keeps future remaining days non-negative', () => {
  assert.deepEqual(shapeTimingEstimate({ median: 21, p25: 7, p75: 40 }), {
    timingStatus: 'future_estimate',
    remainingDaysMedian: 21,
    remainingDaysP25: 7,
    remainingDaysP75: 40,
    behindByDaysMedian: null,
    behindByDaysP25: null,
    behindByDaysP75: null,
    snapshotProxyTotalDaysMedian: null,
    snapshotProxyTotalDaysP25: null,
    snapshotProxyTotalDaysP75: null,
  });
});

test('shapeTimingEstimate converts negative timing into positive lag fields', () => {
  assert.deepEqual(shapeTimingEstimate({ median: -407, p25: -500, p75: -300 }), {
    timingStatus: 'behind_historical_trajectory',
    remainingDaysMedian: null,
    remainingDaysP25: null,
    remainingDaysP75: null,
    behindByDaysMedian: 407,
    behindByDaysP25: 500,
    behindByDaysP75: 300,
    snapshotProxyTotalDaysMedian: null,
    snapshotProxyTotalDaysP25: null,
    snapshotProxyTotalDaysP75: null,
  });
});
