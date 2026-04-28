import test from 'node:test';
import assert from 'node:assert/strict';
import { DIMENSION_QUERIES } from '@/tools/portfolioAggregates/queries';

test('insurer dimension returns i.normalized AS key for searchCases round-trip', () => {
  const cypher = DIMENSION_QUERIES.insurer.buckets;
  assert.match(cypher, /i\.name AS label/);
  assert.match(cypher, /i\.normalized AS key/);
});

test('injury dimension returns i.normalized AS key for searchCases round-trip', () => {
  const cypher = DIMENSION_QUERIES.injury.buckets;
  assert.match(cypher, /i\.name AS label/);
  assert.match(cypher, /i\.normalized AS key/);
});

test('bodyPart dimension returns b.normalized AS key for searchCases round-trip', () => {
  const cypher = DIMENSION_QUERIES.bodyPart.buckets;
  assert.match(cypher, /b\.name AS label/);
  assert.match(cypher, /b\.normalized AS key/);
});

test('non-normalized dimensions do not emit a key field (label is canonical there)', () => {
  for (const dim of ['legalStage', 'caseType', 'phase', 'status', 'missingCritical', 'documentCategory', 'contactType', 'expertSide'] as const) {
    const cypher = DIMENSION_QUERIES[dim].buckets;
    assert.doesNotMatch(cypher, /AS key/, `${dim} should not return a separate key field`);
  }
});
