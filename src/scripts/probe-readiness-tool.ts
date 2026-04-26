import 'dotenv/config';
import { connectNeo4j, closeNeo4j, createSession } from '../db/neo4j';

async function main(): Promise<void> {
  await connectNeo4j();
  const s = createSession();
  try {
    console.log('Pick one case in case_building, derive its readiness for statement_of_defense:');
    const sampleCase = await s.run(
      `MATCH (c:Case) WHERE c.legalStage = 'case_building' RETURN c.caseId AS id LIMIT 1`
    );
    const caseId = sampleCase.records[0]?.get('id') as string;
    console.log(`  Sample caseId: ${caseId}`);

    const cohortKey = 'global|statement_of_defense||all';
    const r = await s.run(
      `MATCH (rc:ReadinessCohort {key: $cohortKey})-[rel:COMMON_SIGNAL]->(rs:ReadinessSignal)
       OPTIONAL MATCH (c:Case {caseId: $caseId})-[:HAS_SIGNAL]->(rs)
       RETURN rs.key AS signal, rel.support AS support, rel.lift AS lift,
              c IS NOT NULL AS caseHas
       ORDER BY rel.weight DESC`,
      { cohortKey, caseId }
    );
    console.log(`\nCommon signals for statement_of_defense cohort vs this case:`);
    for (const rec of r.records) {
      console.log(
        `  ${rec.get('caseHas') ? '✓' : '✗'} ${rec.get('signal')} (cohort support=${(rec.get('support') as number).toFixed(2)})`
      );
    }
  } finally {
    await s.close();
    await closeNeo4j();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
