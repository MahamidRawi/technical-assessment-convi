import 'dotenv/config';
import { connectNeo4j, closeNeo4j, createSession } from '../db/neo4j';
import { runDeriveReadinessPattern } from '../tools/deriveReadinessPattern';
import { runCompareCaseToReadinessPattern } from '../tools/compareCaseToReadinessPattern';
import { runEstimateTimeToStage } from '../tools/estimateTimeToStage';

let exitCode = 0;
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) exitCode = 1;
}

async function pickSeedCase(stage: string): Promise<string> {
  const s = createSession();
  try {
    const r = await s.run(
      `MATCH (c:Case) WHERE c.legalStage = $stage RETURN c.caseId AS id LIMIT 1`,
      { stage }
    );
    const id = r.records[0]?.get('id') as string | undefined;
    if (!id) throw new Error(`No case in stage ${stage}`);
    return id;
  } finally {
    await s.close();
  }
}

async function main(): Promise<void> {
  await connectNeo4j();
  const seedCaseId = await pickSeedCase('case_building');
  const targetStage = 'statement_of_defense';
  console.log(`Seed case: ${seedCaseId}  →  target: ${targetStage}\n`);

  // 1. deriveReadinessPattern
  console.log('--- deriveReadinessPattern ---');
  const pattern = await runDeriveReadinessPattern({ caseId: seedCaseId, targetStage });
  console.log(`  cohortKey:        ${pattern.cohortKey}`);
  console.log(`  scope:            ${pattern.selectedCohortScope}`);
  console.log(`  cohortSize:       ${pattern.cohortSize}`);
  console.log(`  members shown:    ${pattern.cohortMemberCaseIds.length}`);
  console.log(`  signals returned: ${pattern.observedCommonSignals.length}`);
  console.log(`  median days:      ${pattern.timing.medianDaysToStage}`);
  console.log(`  selection:        ${pattern.cohortSelectionCriteria}`);
  check('cohortSize reaches medium-confidence threshold (12)', pattern.cohortSize >= 12, `${pattern.cohortSize}`);
  check('common signals returned', pattern.observedCommonSignals.length > 0, `${pattern.observedCommonSignals.length} signals`);
  check('timing populated', pattern.timing.medianDaysToStage !== null, `${pattern.timing.medianDaysToStage}d`);

  // 2. compareCaseToReadinessPattern
  console.log('\n--- compareCaseToReadinessPattern ---');
  const compare = await runCompareCaseToReadinessPattern({ caseId: seedCaseId, targetStage });
  console.log(`  weightedCoverage: ${(compare.weightedCoverage * 100).toFixed(1)}%`);
  console.log(`  matched:          ${compare.matchedSignals.length}`);
  console.log(`  missing:          ${compare.missingSignals.length}`);
  console.log('  missing signals:');
  for (const m of compare.missingSignals) {
    console.log(`    - ${m.label} (lead ${m.medianLeadDays ?? 'n/a'}d)`);
  }
  check(
    'returned at least one missing signal (case_building → statement_of_defense should mostly miss)',
    compare.missingSignals.length > 0,
    `${compare.missingSignals.length} missing`
  );

  // 3. estimateTimeToStage
  console.log('\n--- estimateTimeToStage ---');
  const estimate = await runEstimateTimeToStage({ caseId: seedCaseId, targetStage });
  console.log(`  cohortKey:        ${estimate.cohortKey}`);
  console.log(`  comparable cases: ${estimate.comparableCaseIds.length}`);
  console.log(`  timingStatus:     ${estimate.timingStatus}`);
  console.log(`  remainingDays:    ${estimate.remainingDaysMedian}`);
  console.log(`  behindByDays:     ${estimate.behindByDaysMedian}`);
  console.log(`  confidence:       ${estimate.confidence}`);
  console.log(`  uncertainty:`);
  for (const u of estimate.uncertaintyReasons) console.log(`    - ${u}`);
  check(
    'timingStatus is not no_estimate',
    estimate.timingStatus !== 'no_estimate',
    estimate.timingStatus
  );
  check(
    'comparableCaseIds is non-empty',
    estimate.comparableCaseIds.length > 0,
    `${estimate.comparableCaseIds.length} peers`
  );

  await closeNeo4j();
  console.log(`\n${exitCode === 0 ? 'ALL PASS' : 'FAILURES PRESENT'}`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('\nFAIL:', err instanceof Error ? err.stack ?? err.message : err);
  void closeNeo4j();
  process.exit(1);
});
