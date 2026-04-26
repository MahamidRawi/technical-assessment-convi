import test from 'node:test';
import assert from 'node:assert/strict';
import { median, quantile, weightedMedian, weightedQuantile } from '@/pipeline/analytics/stats';

test('stats helpers compute quantiles and weighted quantiles', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(weightedMedian([{ value: 10, weight: 1 }, { value: 20, weight: 3 }]), 20);
  assert.equal(
    weightedQuantile(
      [
        { value: 10, weight: 1 },
        { value: 20, weight: 2 },
        { value: 30, weight: 3 },
      ],
      0.25
    ),
    20
  );
});
