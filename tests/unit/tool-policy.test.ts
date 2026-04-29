import test from 'node:test';
import assert from 'node:assert/strict';
import {
  booleanOrNull,
  lowerBoundOrNull,
  normalizeComparableFilters,
  upperBoundOrNull,
} from '@/tools/findComparableCasesByFacts';
import { buildMedicalEvidenceSearchTerms } from '@/tools/searchCasesByMedicalEvidence';

test('normalizeComparableFilters treats accident-type text as case type, not injury node', () => {
  const filters = normalizeComparableFilters({
    workAccidentFlag: true,
    ageMin: 28,
    ageMax: 32,
    injury: 'תאונת דרכים',
    limit: 10,
  });

  assert.deepEqual(filters.caseTypes, ['car_accident_serious', 'car_accident_minor']);
  assert.equal(filters.injury, null);
});

test('boolean comparable filters preserve false values', () => {
  assert.equal(booleanOrNull(true), true);
  assert.equal(booleanOrNull(false), false);
  assert.equal(booleanOrNull(undefined), null);
});

test('neutral comparable numeric bounds are treated as absent filters', () => {
  assert.equal(lowerBoundOrNull(0, 0), null);
  assert.equal(lowerBoundOrNull(1, 0), 1);
  assert.equal(upperBoundOrNull(130, 130), null);
  assert.equal(upperBoundOrNull(129, 130), 129);
  assert.equal(upperBoundOrNull(100, 100), null);
  assert.equal(upperBoundOrNull(99, 100), 99);
});

test('explicit caseType takes precedence over inferred accident case types', () => {
  const filters = normalizeComparableFilters({
    caseType: 'liability',
    injury: 'תאונת דרכים',
    limit: 10,
  });

  assert.equal(filters.caseType, 'liability');
  assert.deepEqual(filters.caseTypes, []);
  assert.equal(filters.injury, null);
});

test('medical evidence term expansion is conditional on query intent', () => {
  const kneeTerms = buildMedicalEvidenceSearchTerms('פגיעה ברך');
  assert.ok(kneeTerms.includes('ברכ'));
  assert.ok(!kneeTerms.includes('נוירולוג'));
  assert.ok(!kneeTerms.includes('עמוד שדרה'));

  const spineNeuroTerms = buildMedicalEvidenceSearchTerms('פגיעה נוירולוגית בעמוד שדרה');
  assert.ok(spineNeuroTerms.includes('נוירולוג'));
  assert.ok(spineNeuroTerms.includes('עמוד שדרה'));
});
