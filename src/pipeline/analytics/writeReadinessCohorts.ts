import type { Session } from 'neo4j-driver';
import { loadCohortInputs } from './cohorts/extract';
import { buildCohortWriteSet } from './cohorts/build';
import { persistCohortWriteSet } from './cohorts/persist';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Analytics');

export async function writeReadinessCohorts(session: Session): Promise<void> {
  logger.log('\nWriting ReadinessCohort nodes');
  const inputs = await loadCohortInputs(session);
  const writeSet = buildCohortWriteSet(inputs);
  await session.executeWrite((tx) => persistCohortWriteSet(tx, writeSet));
  logger.log(`Wrote ${writeSet.cohortRows.length} cohorts with ${writeSet.signalRows.length} common-signal edges`);
}
