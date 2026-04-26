import { connectNeo4j, createSession } from '../../db/neo4j';
import { ensureGraphSchema } from '../schema';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Ingest');

export async function runClear(): Promise<void> {
  logger.log('--clear: wiping graph...');
  await connectNeo4j();
  const session = createSession();
  try {
    await session.run('MATCH (n) DETACH DELETE n');
  } finally {
    await session.close();
  }
  await ensureGraphSchema();
  logger.log('graph cleared and schema re-applied. Re-run `npm run ingest` to load data.');
}
