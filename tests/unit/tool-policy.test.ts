import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTurnToolPolicy,
  nextRequiredTool,
  shouldUseCaseProgressionToStagePolicy,
  shouldUseMedicalEvidenceCaseSearchPolicy,
  shouldUseGraphEvidenceScenarioPolicy,
  shouldUseSeededComparableFollowupPolicy,
} from '@/agents/toolPolicy';
import {
  booleanOrNull,
  lowerBoundOrNull,
  normalizeComparableFilters,
  upperBoundOrNull,
} from '@/tools/findComparableCasesByFacts';
import { buildMedicalEvidenceSearchTerms } from '@/tools/searchCasesByMedicalEvidence';

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

test('case progression policy forces current-case evidence before readiness', () => {
  const prompt = 'מה יכול לקדם את התיק של שפירא ליה לכתב תביעה ולמה?';
  assert.equal(shouldUseCaseProgressionToStagePolicy(prompt), true);

  const policy = buildTurnToolPolicy(prompt);

  assert.ok(policy);
  assert.equal(policy.name, 'caseProgressionToStage');
  assert.deepEqual(policy.requiredToolSequence, [
    'findCase',
    'getCaseOverview',
    'getCaseEvidence',
    'getCaseDocuments',
    'getCaseDocumentFacts',
    'compareCaseToReadinessPattern',
  ]);
  assert.ok(policy.activeTools.includes('getCaseDocuments'));
  assert.ok(policy.activeTools.includes('compareCaseToReadinessPattern'));
});

test('seeded comparable policy catches follow-up similar-case requests', () => {
  const prompt = 'תביא לי את 2 תיקי תאונת הדרכים שיש להם את הכי הרבה המאפיינים הדומים ותפרט בדיוק למה';
  assert.equal(shouldUseSeededComparableFollowupPolicy(prompt), true);

  const policy = buildTurnToolPolicy(prompt);

  assert.ok(policy);
  assert.equal(policy.name, 'seededComparableFollowup');
  assert.deepEqual(policy.requiredToolSequence, []);
  assert.ok(policy.activeTools.includes('findComparableCasesByFacts'));
  assert.ok(!policy.activeTools.includes('portfolioAggregates'));
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
