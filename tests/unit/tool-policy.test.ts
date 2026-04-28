import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTurnToolPolicy,
  nextRequiredTool,
  shouldUseMedicalEvidenceCaseSearchPolicy,
  shouldUseGraphEvidenceScenarioPolicy,
} from '@/agents/toolPolicy';
import { normalizeComparableFilters } from '@/tools/findComparableCasesByFacts';

const reviewerPrompt =
  'קיבלתי תיק של אדם בן 30 שעבר תאונת דרכים בעבודה הוא הגיע אליי אחרי וועדה של ביטוח לאומי שקבעה לו נכויותצ זמניוצתת מה השלבים הבאים ואילו מסמכים אמורים להיות בצתיק - תענה רק על סמך שאילתות מהגרף';

test('graph evidence scenario policy catches reviewer OCR/NII prompt with typos', () => {
  assert.equal(shouldUseGraphEvidenceScenarioPolicy(reviewerPrompt), true);

  const policy = buildTurnToolPolicy(reviewerPrompt);

  assert.ok(policy);
  assert.deepEqual(policy.requiredToolSequence, [
    'searchDocumentEvidence',
    'findComparableCasesByFacts',
    'getCaseValueContext',
  ]);
  assert.ok(policy.activeTools.includes('searchDocumentEvidence'));
  assert.ok(!policy.activeTools.includes('deriveReadinessPattern'));
});

test('graph evidence scenario policy does not intercept explicit readiness questions', () => {
  assert.equal(
    shouldUseGraphEvidenceScenarioPolicy('show the historical readiness pattern for targetStage file_claim'),
    false
  );
});

test('medical evidence case search policy catches semantic medical case listing', () => {
  const prompt = 'ראה לי תיקים שיש בהם פגיעות נוירולוגיות הקשורות לעמוד שדרה';
  assert.equal(shouldUseMedicalEvidenceCaseSearchPolicy(prompt), true);

  const policy = buildTurnToolPolicy(prompt);

  assert.ok(policy);
  assert.equal(policy.name, 'medicalEvidenceCaseSearch');
  assert.deepEqual(policy.requiredToolSequence, ['searchCasesByMedicalEvidence']);
  assert.ok(policy.activeTools.includes('searchCasesByMedicalEvidence'));
});

test('nextRequiredTool returns the first missing required call', () => {
  assert.equal(
    nextRequiredTool(['searchDocumentEvidence', 'findComparableCasesByFacts'], []),
    'searchDocumentEvidence'
  );
  assert.equal(
    nextRequiredTool(['searchDocumentEvidence', 'findComparableCasesByFacts'], ['searchDocumentEvidence']),
    'findComparableCasesByFacts'
  );
  assert.equal(
    nextRequiredTool(
      ['searchDocumentEvidence', 'findComparableCasesByFacts'],
      ['searchDocumentEvidence', 'findComparableCasesByFacts']
    ),
    null
  );
});

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
