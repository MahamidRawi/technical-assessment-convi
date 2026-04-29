import 'dotenv/config';
import { connectNeo4j, closeNeo4j, createSession } from '@/db/neo4j';

async function main(): Promise<void> {
  await connectNeo4j();
  const session = createSession();
  try {
    const r = await session.run(`
      MATCH ()-[r:SIMILAR_TO]->()
      RETURN
        count(r) AS total,
        min(r.combinedScore) AS minScore,
        max(r.combinedScore) AS maxScore,
        avg(r.combinedScore) AS avgScore,
        percentileCont(r.combinedScore, 0.50) AS p50,
        percentileCont(r.combinedScore, 0.90) AS p90,
        percentileCont(r.combinedScore, 0.99) AS p99
    `);
    const rec = r.records[0];
    console.log('SIMILAR_TO score distribution (directed edges):');
    for (const k of ['total','minScore','maxScore','avgScore','p50','p90','p99']) {
      const v = rec.get(k);
      console.log(`  ${k.padEnd(10)} ${typeof v?.toNumber === 'function' ? v.toNumber() : v}`);
    }
    const buckets = await session.run(`
      MATCH ()-[r:SIMILAR_TO]->()
      WITH r.combinedScore AS s
      WITH CASE
        WHEN s < 0.20 THEN '0.18–0.20'
        WHEN s < 0.30 THEN '0.20–0.30'
        WHEN s < 0.40 THEN '0.30–0.40'
        WHEN s < 0.50 THEN '0.40–0.50'
        WHEN s < 0.70 THEN '0.50–0.70'
        ELSE '0.70+'
      END AS bucket
      RETURN bucket, count(*) AS c ORDER BY bucket
    `);
    console.log('\nBuckets:');
    for (const rec of buckets.records) {
      console.log(`  ${rec.get('bucket').padEnd(12)} ${rec.get('c').toNumber()}`);
    }
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
