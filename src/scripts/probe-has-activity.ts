import 'dotenv/config';
import { connectNeo4j, closeNeo4j } from '../db/neo4j';

async function main(): Promise<void> {
  const d = await connectNeo4j();
  const s = d.session();
  try {
    const r2 = await s.run(
      'MATCH (a)-[:HAS_ACTIVITY]->(b) RETURN DISTINCT labels(a) AS fromLabels, labels(b) AS toLabels, count(*) AS n ORDER BY n DESC'
    );
    console.log('HAS_ACTIVITY edge shapes:');
    for (const rec of r2.records) {
      console.log(
        '  from=',
        rec.get('fromLabels'),
        'to=',
        rec.get('toLabels'),
        'count=',
        rec.get('n').toNumber()
      );
    }
  } finally {
    await s.close();
    await closeNeo4j();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
