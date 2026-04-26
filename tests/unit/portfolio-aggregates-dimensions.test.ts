import test from 'node:test';
import assert from 'node:assert/strict';
import { dimensionSchema, DIMENSION_QUERIES } from '@/tools/portfolioAggregates/queries';

test('portfolioAggregates dimensionSchema accepts contactType and expertSide', () => {
  assert.equal(dimensionSchema.parse('contactType'), 'contactType');
  assert.equal(dimensionSchema.parse('expertSide'), 'expertSide');
});

test('every declared AggregateDimension has buckets/total/distinct cypher', () => {
  for (const dim of dimensionSchema.options) {
    const queries = DIMENSION_QUERIES[dim];
    assert.ok(queries, `missing DIMENSION_QUERIES entry for ${dim}`);
    assert.ok(queries.buckets.trim(), `${dim}.buckets cypher empty`);
    assert.ok(queries.total.trim(), `${dim}.total cypher empty`);
    assert.ok(queries.distinct.trim(), `${dim}.distinct cypher empty`);
    assert.equal(typeof queries.partitioning, 'boolean');
  }
});

test('contactType is a non-partitioning dimension (a contact can serve multiple roles)', () => {
  assert.equal(DIMENSION_QUERIES.contactType.partitioning, false);
});

test('expertSide is a non-partitioning dimension (a case can have both ours and court)', () => {
  assert.equal(DIMENSION_QUERIES.expertSide.partitioning, false);
});
