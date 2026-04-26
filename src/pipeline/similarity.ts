import 'dotenv/config';
import type { Session } from 'neo4j-driver';
import { connectNeo4j, closeNeo4j, createSession } from '../db/neo4j';
import { createLogger } from '@/utils/logger';
import { loadCaseSignals } from './similarity/load';
import { maybeAttachEmbeddings } from './similarity/embeddings';
import { computePairs } from './similarity/compute';
import type { SimilarityWriteRow } from './similarity/types';

const logger = createLogger('Similarity');

const WRITE_PAIRS_CYPHER = `
  UNWIND $rows AS row
  MATCH (a:Case {caseId: row.leftId}), (b:Case {caseId: row.rightId})
  MERGE (a)-[r1:SIMILAR_TO]->(b)
  SET r1.score = row.score,
      r1.signalScore = row.signalScore,
      r1.semanticScore = row.semanticScore,
      r1.combinedScore = row.combinedScore,
      r1.similarityMethod = row.similarityMethod,
      r1.reasons = row.reasons,
      r1.overlapSignalKeys = row.overlapSignalKeys
  MERGE (b)-[r2:SIMILAR_TO]->(a)
  SET r2.score = row.score,
      r2.signalScore = row.signalScore,
      r2.semanticScore = row.semanticScore,
      r2.combinedScore = row.combinedScore,
      r2.similarityMethod = row.similarityMethod,
      r2.reasons = row.reasons,
      r2.overlapSignalKeys = row.overlapSignalKeys
`;

async function writePairs(session: Session, rows: SimilarityWriteRow[]): Promise<void> {
  await session.run(WRITE_PAIRS_CYPHER, { rows });
}

export async function computeSimilarityEdges(session: Session): Promise<number> {
  await session.run('MATCH ()-[r:SIMILAR_TO]->() DELETE r');
  const cases = await loadCaseSignals(session);
  const similarityMethod = await maybeAttachEmbeddings(cases);
  const rows = computePairs(cases, similarityMethod);
  await writePairs(session, rows);
  logger.log(`Wrote ${rows.length} unique pairs`);
  return rows.length;
}

if (require.main === module) {
  (async () => {
    await connectNeo4j();
    const session = createSession();
    try {
      const pairs = await computeSimilarityEdges(session);
      logger.log(`Done. ${pairs} pair(s).`);
    } finally {
      await session.close();
      await closeNeo4j();
    }
  })().catch((err) => {
    logger.error('Fatal error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
