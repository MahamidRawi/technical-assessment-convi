import 'dotenv/config';
import { connectNeo4j, closeNeo4j } from '../db/neo4j';
import { createLogger } from '@/utils/logger';

const logger = createLogger('ClearGraph');

async function main(): Promise<void> {
  const driver = await connectNeo4j();
  const session = driver.session();
  try {
    const before = await session.run('MATCH (n) RETURN count(n) AS total');
    logger.log(`Before: ${before.records[0]?.get('total')?.toNumber?.() ?? 0} nodes`);
    await session.run('MATCH (n) DETACH DELETE n');
    const after = await session.run('MATCH (n) RETURN count(n) AS total');
    logger.log(`After: ${after.records[0]?.get('total')?.toNumber?.() ?? 0} nodes`);
    logger.log('Done — run `npm run setup` to rebuild from a clean state');
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

main().catch((err) => {
  logger.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
