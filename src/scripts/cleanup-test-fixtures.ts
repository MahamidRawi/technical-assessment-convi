import 'dotenv/config';
import { closeNeo4j, connectNeo4j, createSession } from '@/db/neo4j';
import { createLogger } from '@/utils/logger';

const logger = createLogger('cleanup-test-fixtures');

export async function cleanupTestFixtures(): Promise<number> {
  await connectNeo4j();
  const session = createSession();
  try {
    const result = await session.run(`
      MATCH (c:Case)
      WHERE c.caseId IN ['CASE-TARGET', 'CASE-CONTROL', 'CASE-NODATE']
         OR c.caseId STARTS WITH 'CASE-PEER-'
      WITH collect(c) AS cases, count(c) AS count
      FOREACH (c IN cases | DETACH DELETE c)
      RETURN count
    `);
    const raw = result.records[0]?.get('count');
    const deleted = typeof raw?.toNumber === 'function' ? raw.toNumber() : Number(raw ?? 0);
    logger.log(`Deleted ${deleted} leaked test fixture case(s)`);
    return deleted;
  } finally {
    await session.close();
  }
}

if (require.main === module) {
  cleanupTestFixtures()
    .catch((error) => {
      logger.error('failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    })
    .finally(() => closeNeo4j());
}
