import 'dotenv/config';
import { connectNeo4j, closeNeo4j } from '../db/neo4j';
import { createLogger } from '@/utils/logger';

const logger = createLogger('CheckNeo4j');

async function main(): Promise<void> {
  logger.log('Connecting...');
  const driver = await connectNeo4j();
  const session = driver.session();
  try {
    const result = await session.run('RETURN "neo4j works" AS msg');
    const msg = result.records[0]?.get('msg');
    if (typeof msg !== 'string') throw new Error('Neo4j health check returned a non-string message');
    logger.log('Query result:', msg);

    const countResult = await session.run('MATCH (n) RETURN count(n) AS total');
    const total = countResult.records[0]?.get('total');
    logger.log('Total nodes in graph:', total?.toNumber?.() ?? total);

    logger.log('PASS');
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

main().catch((err) => {
  logger.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
