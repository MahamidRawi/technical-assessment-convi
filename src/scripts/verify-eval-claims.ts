import 'dotenv/config';
import { connectNeo4j, closeNeo4j } from '../db/neo4j';

async function main(): Promise<void> {
  const d = await connectNeo4j();
  const s = d.session();
  try {
    const checks: Array<[string, string]> = [
      ['Total Case nodes', 'MATCH (c:Case) RETURN count(c) AS n'],
      [
        'Phase=active count',
        "MATCH (c:Case) WHERE c.phase = 'active' RETURN count(c) AS n",
      ],
      [
        'Phase=lead count',
        "MATCH (c:Case) WHERE c.phase = 'lead' RETURN count(c) AS n",
      ],
      [
        'Signed + case_building count',
        "MATCH (c:Case) WHERE c.legalStage = 'case_building' AND c.isSigned = true RETURN count(c) AS n",
      ],
      [
        'SoL within 6 months count',
        'MATCH (c:Case) WHERE c.monthsSinceEvent IS NOT NULL AND (18 - c.monthsSinceEvent) >= 0 AND (18 - c.monthsSinceEvent) <= 6 RETURN count(c) AS n',
      ],
      [
        'Cases reaching file_claim with timing',
        "MATCH (c:Case) OPTIONAL MATCH (c)-[r:REACHED_STAGE]->(:Stage {name: 'file_claim'}) WITH c, r WHERE (r IS NOT NULL OR (c.legalStage = 'file_claim' AND c.legalStageEnteredAt IS NOT NULL)) AND c.eventDate IS NOT NULL RETURN count(c) AS n",
      ],
      [
        'court_expert cohort members',
        "MATCH (rc:ReadinessCohort {targetStage: 'court_expert', scope: 'global'})-[:HAS_MEMBER]->(c:Case) RETURN count(c) AS n",
      ],
      [
        'statement_of_defense global cohort members',
        "MATCH (rc:ReadinessCohort {targetStage: 'statement_of_defense', scope: 'global'})-[:HAS_MEMBER]->(c:Case) RETURN count(c) AS n",
      ],
    ];
    for (const [label, cypher] of checks) {
      const r = await s.run(cypher);
      console.log(`${label}: ${r.records[0]?.get('n')?.toNumber?.() ?? 0}`);
    }

    console.log('\nCase 7489 resolution:');
    const c7489 = await s.run(
      `MATCH (c:Case) WHERE c.caseName CONTAINS '7489' RETURN c.caseId AS id, c.caseName AS name, c.caseType AS type, c.legalStage AS stage, c.completionRate AS rate, c.monthsSinceEvent AS m, c.missingCritical AS missing`
    );
    for (const rec of c7489.records) {
      console.log(`  caseId: ${rec.get('id')}`);
      console.log(`  name: ${rec.get('name')}`);
      console.log(`  type: ${rec.get('type')}, stage: ${rec.get('stage')}`);
      console.log(`  completionRate: ${rec.get('rate')}, monthsSinceEvent: ${rec.get('m')?.toNumber?.()}`);
      console.log(`  missing: ${JSON.stringify(rec.get('missing'))}`);
    }

    console.log('\nCommunications on 695099b18f3a7575f122f1e5 by direction:');
    const comms = await s.run(
      `MATCH (c:Case)-[:HAS_COMMUNICATION]->(com:Communication)
       WHERE c.sourceId = $sid OR c.caseId = $sid
       RETURN com.direction AS dir, count(com) AS n`,
      { sid: '695099b18f3a7575f122f1e5' }
    );
    for (const rec of comms.records) {
      console.log(`  ${rec.get('dir')}: ${rec.get('n').toNumber()}`);
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
