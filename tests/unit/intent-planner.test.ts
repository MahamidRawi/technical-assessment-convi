import test from 'node:test';
import assert from 'node:assert/strict';
import { planTurn } from '@/agents/intentPlanner';
import { validateToolCallAgainstPlan } from '@/tools/toolCallPolicy';

test('planner routes portfolio graph requests', () => {
  assert.equal(planTurn('תבנה לי גרף של התיקים').intent, 'portfolio_graph');
});

test('planner routes medical insight requests', () => {
  assert.equal(planTurn('תן לי תובנה רפואית מעניינת').intent, 'portfolio_insight');
});

test('planner routes global similarity when no seed case is named', () => {
  const plan = planTurn('תביא לי את 2 תיקי תאונת הדרכים הכי דומים');
  assert.equal(plan.intent, 'global_similarity');
  assert.deepEqual(plan.requiredTools, ['rankSimilarCasePairs']);
});

test('planner routes seed similarity when a seed case is named', () => {
  const plan = planTurn('תיקים דומים ל-6938747665d3d3eb1c9967a4');
  assert.equal(plan.intent, 'seed_similarity');
  assert.deepEqual(plan.requiredTools, ['findCase', 'findSimilarCases']);
});

test('planner routes stage progression requests', () => {
  const plan = planTurn('מה השלב הבא בתיק הזה?');
  assert.equal(plan.intent, 'stage_progression');
  assert.ok(plan.requiredTools.includes('getObservedStageTransitions'));
});

test('planner routes qualitative extreme requests as proxy-sensitive', () => {
  const plan = planTurn('תמצא לי תיק שיש בו פציעה הכי משמעותית');
  assert.equal(plan.intent, 'qualitative_extreme');
  assert.ok(plan.requiredCaveats?.includes('proxy'));
});

test('tool policy rejects caseType passed as findSimilarCases caseId', () => {
  assert.throws(
    () => validateToolCallAgainstPlan('findSimilarCases', { caseId: 'car_accident_serious' }),
    /caseType/
  );
});

test('tool policy rejects communication direction without route approval', () => {
  const plan = planTurn('תן לי פרט מעניין מההתכתבויות של ליה');
  assert.throws(
    () =>
      validateToolCallAgainstPlan(
        'getCaseCommunications',
        { caseId: 'case-id', direction: 'incoming' },
        plan
      ),
    /direction/
  );
});

test('tool policy allows communication direction when user requested it', () => {
  const plan = planTurn('תראה לי הודעות נכנסות בתיק של ליה');
  assert.doesNotThrow(() =>
    validateToolCallAgainstPlan(
      'getCaseCommunications',
      { caseId: 'case-id', direction: 'incoming' },
      plan
    )
  );
});
