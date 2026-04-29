import 'dotenv/config';
import { connectMongo, closeMongo, getDb } from '@/db/mongo';
import { connectNeo4j, closeNeo4j, createSession } from '@/db/neo4j';
import { writeDocuments } from '@/pipeline/ingest/writeDocuments';

async function main(): Promise<void> {
  await connectMongo();
  const db = getDb('convi-assessment');
  await connectNeo4j();
  const session = createSession();
  try {
    const cases = await db.collection('cases').find({}, { projection: { caseId: 1 } }).toArray();
    const caseIds = new Set(cases.map((c) => String(c.caseId)));
    console.log(`Replaying writeDocuments against ${caseIds.size} cases`);
    await writeDocuments(session, db, 0, caseIds);
    const r = await session.run(`MATCH ()-[r:DERIVED_FROM]->() RETURN count(r) AS c`);
    const c = r.records[0].get('c').toNumber?.() ?? r.records[0].get('c');
    console.log(`DERIVED_FROM edges in graph: ${c}`);
    const archived = await session.run(`MATCH (d:Document) WHERE d.archived = true RETURN count(d) AS c`);
    const ac = archived.records[0].get('c').toNumber?.() ?? archived.records[0].get('c');
    console.log(`Archived Document nodes:     ${ac}`);
  } finally {
    await session.close();
    await closeNeo4j();
    await closeMongo();
  }
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
