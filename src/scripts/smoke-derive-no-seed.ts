import 'dotenv/config';
import { connectNeo4j, closeNeo4j } from '../db/neo4j';
import { runDeriveReadinessPattern } from '../tools/deriveReadinessPattern';

async function main(): Promise<void> {
  await connectNeo4j();
  const r = await runDeriveReadinessPattern({ targetStage: 'court_expert' });
  console.log('caseId:        ', r.caseId);
  console.log('cohortKey:     ', r.cohortKey);
  console.log('cohortSize:    ', r.cohortSize);
  console.log('selection:     ', r.cohortSelectionCriteria);
  console.log('scope:         ', r.selectedCohortScope);
  console.log('signals:       ', r.observedCommonSignals.length);
  for (const s of r.observedCommonSignals) {
    console.log(`  - ${s.label} (support ${s.support.toFixed(2)}, lift ${s.lift.toFixed(2)})`);
  }
  await closeNeo4j();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
