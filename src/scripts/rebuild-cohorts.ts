import 'dotenv/config';
import { connectNeo4j, closeNeo4j, createSession } from '../db/neo4j';
import { backfillCurrentStageEvents } from '../pipeline/ingest/writeActivity';
import { writeSignals } from '../pipeline/analytics/writeSignals';
import { writeReadinessCohorts } from '../pipeline/analytics/writeReadinessCohorts';

async function main(): Promise<void> {
  await connectNeo4j();
  const session = createSession();
  try {
    await backfillCurrentStageEvents(session);
    await writeSignals(session);
    await writeReadinessCohorts(session);
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
