import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_ENTRIES } from '@/tools/registry';

test('registry exposes cohort-based readiness tools and removes static claim readiness', () => {
  const names = TOOL_ENTRIES.map((entry) => entry.name);
  assert.ok(names.includes('findCase'));
  assert.ok(names.includes('deriveReadinessPattern'));
  assert.ok(names.includes('compareCaseToReadinessPattern'));
  assert.ok(names.includes('estimateTimeToStage'));
  assert.ok(names.includes('rankCasesByStageTransitionTime'));
  assert.ok(!names.includes('explainReadinessDecision'));
  assert.ok(!names.includes('getCaseGraphContext'));
  assert.ok(!names.includes('getClaimReadiness'));
});

test('registry exposes portfolio-level contact and expert listing tools', () => {
  const names = TOOL_ENTRIES.map((entry) => entry.name);
  assert.ok(names.includes('listPortfolioContacts'));
  assert.ok(names.includes('listPortfolioExperts'));
});

test('registry exposes OCR fact and value reasoning tools', () => {
  const names = TOOL_ENTRIES.map((entry) => entry.name);
  assert.ok(names.includes('searchDocumentEvidence'));
  assert.ok(names.includes('getCaseDocumentFacts'));
  assert.ok(names.includes('findComparableCasesByFacts'));
  assert.ok(names.includes('getCaseValueContext'));
  assert.ok(names.includes('searchCasesByMedicalEvidence'));
});
