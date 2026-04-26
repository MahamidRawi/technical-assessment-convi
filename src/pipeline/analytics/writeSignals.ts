import type { Session } from 'neo4j-driver';
import { collectSignalObservations } from './signals/extract';
import { buildSignalWriteSet } from './signals/build';
import { persistSignalWriteSet } from './signals/persist';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Analytics');

export async function writeSignals(session: Session): Promise<void> {
  logger.log('\nWriting ReadinessSignal nodes + HAS_SIGNAL edges');
  const observations = await collectSignalObservations(session);
  const writeSet = buildSignalWriteSet(observations);
  await session.executeWrite((tx) => persistSignalWriteSet(tx, writeSet));
  logger.log(`Wrote ${writeSet.signalDefs.length} ReadinessSignals and ${writeSet.caseSignalRows.length} HAS_SIGNAL edges`);
}
