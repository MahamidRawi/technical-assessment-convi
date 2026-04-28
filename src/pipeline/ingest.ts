import 'dotenv/config';
import { connectMongo, closeMongo, getDb, readCollection } from '../db/mongo';
import { connectNeo4j, closeNeo4j, createSession } from '../db/neo4j';
import { ensureGraphSchema } from './schema';
import { computeSimilarityEdges } from './similarity';
import { MongoCaseSchema, FinancialProjectionSchema } from '../types/mongo.types';
import type { CaseNode } from '../types/graph.types';
import { normalizeCaseNode } from './ingest/normalize';
import { extractRowsFromCase, type ExtractedRows } from './ingest/extract';
import { writeCases, writeContactsAndClients } from './ingest/writeCore';
import { writeDocuments, writeCommunications } from './ingest/writeContent';
import { writeDocumentContentAndFacts } from './ingest/documentContent';
import { writeCaseValuations } from './ingest/writeValuations';
import { writeStages, writeInjuriesAndBodyParts, writeInsurers, writeExperts } from './ingest/writeTaxonomy';
import { writeReachedStages, backfillCurrentStageEvents } from './ingest/writeActivity';
import { runClear } from './ingest/clear';
import { writeSignals } from './analytics/writeSignals';
import { writeReadinessCohorts } from './analytics/writeReadinessCohorts';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Ingest');

interface CliFlags {
  isDryRun: boolean;
  isClear: boolean;
  skipSimilarity: boolean;
  explicitLimit: number | undefined;
}

function parseCliFlags(argv: string[]): CliFlags {
  const args = argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit'));
  return {
    isDryRun: args.includes('--dry-run'),
    isClear: args.includes('--clear'),
    skipSimilarity: args.includes('--skip-similarity'),
    explicitLimit: limitArg ? parseInt(limitArg.split('=')[1] ?? '10') : undefined,
  };
}

async function loadCasesAndProjections(
  db: ReturnType<typeof getDb>,
  fetchLimit: number
): Promise<{ caseNodes: Map<string, CaseNode>; rows: ExtractedRows }> {
  const cases = await readCollection(db, 'cases', MongoCaseSchema, {}, { limit: fetchLimit });
  logger.log(`Fetched ${cases.length} cases`);

  const caseNodes = new Map<string, CaseNode>();
  const rows: ExtractedRows = { injuryRows: [], bodyPartRows: [], insurerRows: [], expertRows: [] };

  for (const mongoCase of cases) {
    const projectionDoc = await db
      .collection('case_financial_projections')
      .findOne({ caseId: mongoCase.caseId });
    const parsed = projectionDoc ? FinancialProjectionSchema.safeParse(projectionDoc) : null;
    const projection = parsed?.success ? parsed.data : null;
    caseNodes.set(mongoCase.caseId, normalizeCaseNode(mongoCase, projection));
    extractRowsFromCase(mongoCase, projection, rows);
  }
  return { caseNodes, rows };
}

function logDryRun(caseNodes: Map<string, CaseNode>): void {
  logger.log('\nNormalized Case Nodes (sample):');
  logger.log('─'.repeat(80));
  for (const node of caseNodes.values()) {
    logger.log(JSON.stringify(node, null, 2));
    logger.log('─'.repeat(80));
  }
  logger.log('\nDRY RUN — no data written to Neo4j');
}

async function writeAll(
  db: ReturnType<typeof getDb>,
  fetchLimit: number,
  caseNodes: Map<string, CaseNode>,
  rows: ExtractedRows,
  skipSimilarity: boolean
): Promise<void> {
  await ensureGraphSchema();
  await connectNeo4j();
  const session = createSession();
  try {
    const caseIds = new Set(caseNodes.keys());
    const nodeList = Array.from(caseNodes.values());

    await writeCases(session, nodeList);
    const contacts = await writeContactsAndClients(session, db, fetchLimit, nodeList, caseIds);
    await writeDocuments(session, db, fetchLimit, caseIds);
    await writeDocumentContentAndFacts(session, db, fetchLimit, caseIds);
    await writeCommunications(session, db, fetchLimit, caseIds, contacts);
    await writeCaseValuations(session, db, fetchLimit, caseIds);
    await writeStages(session, nodeList);
    await writeInjuriesAndBodyParts(session, rows.injuryRows, rows.bodyPartRows);
    await writeInsurers(session, rows.insurerRows);
    await writeExperts(session, rows.expertRows);
    await writeReachedStages(session, db, caseIds);
    await backfillCurrentStageEvents(session);
    await writeSignals(session);
    await writeReadinessCohorts(session);

    if (!skipSimilarity) {
      logger.log('\nComputing similarity edges');
      const pairs = await computeSimilarityEdges(session);
      logger.log(`Wrote ${pairs} SIMILAR_TO pairs`);
    } else {
      logger.log('\n--skip-similarity: skipping SIMILAR_TO computation');
    }
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

async function main(): Promise<void> {
  const flags = parseCliFlags(process.argv);
  logger.log('Starting');
  logger.log(
    `dry-run=${flags.isDryRun} clear=${flags.isClear} limit=${
      flags.explicitLimit ?? (flags.isDryRun ? '3 (dry-run default)' : 'all')
    }`
  );

  if (flags.isClear) {
    try {
      await runClear();
    } finally {
      await closeNeo4j();
    }
    return;
  }

  await connectMongo();
  const db = getDb('convi-assessment');
  try {
    const fetchLimit = flags.explicitLimit ?? (flags.isDryRun ? 3 : 0);
    const { caseNodes, rows } = await loadCasesAndProjections(db, fetchLimit);

    if (flags.isDryRun) {
      logDryRun(caseNodes);
      return;
    }
    if (caseNodes.size === 0) {
      logger.log('No cases fetched — nothing to write.');
      return;
    }
    await writeAll(db, fetchLimit, caseNodes, rows, flags.skipSimilarity);
    logger.log('\nCompleted');
  } finally {
    await closeMongo();
  }
}

main().catch((err) => {
  logger.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
