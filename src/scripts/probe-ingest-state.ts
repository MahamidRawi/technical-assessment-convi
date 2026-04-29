import 'dotenv/config';
import { connectNeo4j, closeNeo4j, createSession } from '@/db/neo4j';

async function main(): Promise<void> {
  await connectNeo4j();
  const session = createSession();
  try {
    const labels = ['Case', 'Contact', 'Document', 'DocumentChunk', 'EvidenceFact', 'Communication', 'Stage', 'StageEvent', 'ReadinessCohort', 'CaseValuation', 'Injury', 'BodyPart', 'InsuranceCompany', 'Expert', 'ActivityEvent'];
    for (const label of labels) {
      const r = await session.run(`MATCH (n:\`${label}\`) RETURN count(n) AS c`);
      const c = r.records[0].get('c').toNumber?.() ?? r.records[0].get('c');
      console.log(`  ${label.padEnd(20)} ${c}`);
    }
    const rels = await session.run(`MATCH ()-[r]->() RETURN type(r) AS t, count(r) AS c ORDER BY c DESC`);
    console.log('\nRelationships:');
    for (const rec of rels.records) {
      console.log(`  ${(rec.get('t') as string).padEnd(24)} ${rec.get('c').toNumber?.() ?? rec.get('c')}`);
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
