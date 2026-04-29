import 'dotenv/config';
import { connectNeo4j, closeNeo4j, createSession } from '@/db/neo4j';

async function main(): Promise<void> {
  await connectNeo4j();
  const session = createSession();
  try {
    const r = await session.run(`
      MATCH (c:Case)-[:HAS_DOCUMENT]->(live:Document)-[:DERIVED_FROM]->(parent:Document)
      WHERE parent.archived = true
      RETURN c.caseId AS caseId, c.caseName AS caseName,
             live.fileName AS liveFile, parent.fileName AS archivedFile
      ORDER BY caseId
    `);
    console.log('Cases with archived prior-version provenance:');
    for (const rec of r.records) {
      console.log(`  caseId=${rec.get('caseId')}`);
      console.log(`    name=${rec.get('caseName')}`);
      console.log(`    live=${rec.get('liveFile')}`);
      console.log(`    archived=${rec.get('archivedFile')}`);
    }
    console.log(`\n${r.records.length} pair(s)`);
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
