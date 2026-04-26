import 'dotenv/config';
import { connectNeo4j, closeNeo4j } from '../db/neo4j';

async function main(): Promise<void> {
  const d = await connectNeo4j();
  const s = d.session();
  try {
    const checks: Array<[string, string]> = [
      ['StageEvent nodes total', 'MATCH (n:StageEvent) RETURN count(n) AS n'],
      ['HAS_STAGE_EVENT (Case→StageEvent) rels', 'MATCH (:Case)-[r:HAS_STAGE_EVENT]->(:StageEvent) RETURN count(r) AS n'],
      ['FOR_STAGE (StageEvent→Stage) rels', 'MATCH (:StageEvent)-[r:FOR_STAGE]->(:Stage) RETURN count(r) AS n'],
      ['Distinct cases with any StageEvent', 'MATCH (c:Case)-[:HAS_STAGE_EVENT]->(:StageEvent) RETURN count(DISTINCT c) AS n'],
      [
        'Cases with full extract path (Case→StageEvent→Stage)',
        'MATCH (c:Case)-[:HAS_STAGE_EVENT]->(:StageEvent)-[:FOR_STAGE]->(:Stage) RETURN count(DISTINCT c) AS n',
      ],
    ];
    for (const [label, cypher] of checks) {
      const r = await s.run(cypher);
      console.log(`${label}: ${r.records[0]?.get('n')?.toNumber?.() ?? 0}`);
    }

    const dist = await s.run(`
      MATCH (c:Case)-[:HAS_STAGE_EVENT]->(se:StageEvent)-[:FOR_STAGE]->(s:Stage)
      WITH s.name AS stage, count(DISTINCT c) AS members
      WHERE members >= 12
      RETURN stage, members ORDER BY members DESC
    `);
    console.log('\nStages with >= 12 cases reaching them (would form cohorts globally):');
    for (const r of dist.records) console.log(`  ${r.get('stage')}: ${r.get('members').toNumber()}`);

    const distAll = await s.run(`
      MATCH (c:Case)-[:HAS_STAGE_EVENT]->(se:StageEvent)-[:FOR_STAGE]->(s:Stage)
      WITH s.name AS stage, count(DISTINCT c) AS members
      RETURN stage, members ORDER BY members DESC
    `);
    console.log('\nAll stage reach distribution:');
    for (const r of distAll.records) console.log(`  ${r.get('stage')}: ${r.get('members').toNumber()}`);
  } finally {
    await s.close();
    await closeNeo4j();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
