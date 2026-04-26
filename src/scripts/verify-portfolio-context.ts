import 'dotenv/config';
import { connectNeo4j, closeNeo4j } from '../db/neo4j';

async function main(): Promise<void> {
  const driver = await connectNeo4j();
  const s = driver.session();
  try {
    const a = await s.run('MATCH (c:Case) RETURN count(c) AS n');
    console.log('Total Case nodes:', a.records[0].get('n').toNumber());

    const b = await s.run(
      'MATCH (c:Case) WHERE c.legalStage IS NOT NULL RETURN c.legalStage AS stage, count(c) AS n ORDER BY n DESC'
    );
    console.log('Distribution by legalStage:');
    for (const r of b.records) console.log('  ', r.get('stage'), '=', r.get('n').toNumber());

    const c = await s.run('MATCH ()-[r:REACHED_STAGE]->() RETURN count(r) AS n');
    console.log('Total REACHED_STAGE relationships in graph:', c.records[0].get('n').toNumber());

    const d = await s.run(
      'MATCH (c:Case) WHERE c.legalStageEnteredAt IS NOT NULL RETURN count(c) AS n'
    );
    console.log('Cases with c.legalStageEnteredAt set:', d.records[0].get('n').toNumber());

    const e = await s.run('MATCH (c:Case) WHERE c.eventDate IS NOT NULL RETURN count(c) AS n');
    console.log('Cases with c.eventDate set:', e.records[0].get('n').toNumber());
  } finally {
    await s.close();
    await closeNeo4j();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
