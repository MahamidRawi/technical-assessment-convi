import 'dotenv/config';
import { connectNeo4j, closeNeo4j, createSession } from '../db/neo4j';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Schema');

const CONSTRAINTS: Array<[string, string]> = [
  ['Case.sourceId', 'CREATE CONSTRAINT IF NOT EXISTS FOR (c:Case) REQUIRE c.sourceId IS UNIQUE'],
  ['Contact.dedupKey', 'CREATE CONSTRAINT IF NOT EXISTS FOR (con:Contact) REQUIRE con.dedupKey IS UNIQUE'],
  ['Document.sourceId', 'CREATE CONSTRAINT IF NOT EXISTS FOR (d:Document) REQUIRE d.sourceId IS UNIQUE'],
  ['Communication.sourceId', 'CREATE CONSTRAINT IF NOT EXISTS FOR (com:Communication) REQUIRE com.sourceId IS UNIQUE'],
  ['Stage.name', 'CREATE CONSTRAINT IF NOT EXISTS FOR (s:Stage) REQUIRE s.name IS UNIQUE'],
  ['DocumentCategory.name', 'CREATE CONSTRAINT IF NOT EXISTS FOR (dc:DocumentCategory) REQUIRE dc.name IS UNIQUE'],
  ['DocumentType.name', 'CREATE CONSTRAINT IF NOT EXISTS FOR (dt:DocumentType) REQUIRE dt.name IS UNIQUE'],
  ['Injury.normalized', 'CREATE CONSTRAINT IF NOT EXISTS FOR (i:Injury) REQUIRE i.normalized IS UNIQUE'],
  ['BodyPart.normalized', 'CREATE CONSTRAINT IF NOT EXISTS FOR (b:BodyPart) REQUIRE b.normalized IS UNIQUE'],
  ['InsuranceCompany.normalized', 'CREATE CONSTRAINT IF NOT EXISTS FOR (ic:InsuranceCompany) REQUIRE ic.normalized IS UNIQUE'],
  ['Expert.key', 'CREATE CONSTRAINT IF NOT EXISTS FOR (e:Expert) REQUIRE e.key IS UNIQUE'],
  ['ActivityEvent.sourceId', 'CREATE CONSTRAINT IF NOT EXISTS FOR (ae:ActivityEvent) REQUIRE ae.sourceId IS UNIQUE'],
  ['StageEvent.key', 'CREATE CONSTRAINT IF NOT EXISTS FOR (se:StageEvent) REQUIRE se.key IS UNIQUE'],
  ['ReadinessSignal.key', 'CREATE CONSTRAINT IF NOT EXISTS FOR (rs:ReadinessSignal) REQUIRE rs.key IS UNIQUE'],
  ['ReadinessCohort.key', 'CREATE CONSTRAINT IF NOT EXISTS FOR (rc:ReadinessCohort) REQUIRE rc.key IS UNIQUE'],
  ['DocumentChunk.chunkId', 'CREATE CONSTRAINT IF NOT EXISTS FOR (dc:DocumentChunk) REQUIRE dc.chunkId IS UNIQUE'],
  ['EvidenceFact.factId', 'CREATE CONSTRAINT IF NOT EXISTS FOR (ef:EvidenceFact) REQUIRE ef.factId IS UNIQUE'],
  ['CaseValuation.valuationId', 'CREATE CONSTRAINT IF NOT EXISTS FOR (cv:CaseValuation) REQUIRE cv.valuationId IS UNIQUE'],
  ['DamageComponent.componentId', 'CREATE CONSTRAINT IF NOT EXISTS FOR (dc:DamageComponent) REQUIRE dc.componentId IS UNIQUE'],
];

const INDEXES: Array<[string, string]> = [
  ['Case.caseId', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.caseId)'],
  ['Case.caseNumber', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.caseNumber)'],
  ['Case.caseType', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.caseType)'],
  ['Case.legalStage', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.legalStage)'],
  ['Case.subStage', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.subStage)'],
  ['Case.phase', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.phase)'],
  ['Case.completionRate', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.completionRate)'],
  ['Case.workAccidentFlag', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.workAccidentFlag)'],
  ['Case.clientAge', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.clientAge)'],
  ['Contact.name', 'CREATE INDEX IF NOT EXISTS FOR (con:Contact) ON (con.name)'],
  ['Contact.normalizedName', 'CREATE INDEX IF NOT EXISTS FOR (con:Contact) ON (con.normalizedName)'],
  ['Contact.contactType', 'CREATE INDEX IF NOT EXISTS FOR (con:Contact) ON (con.contactType)'],
  ['Document.caseId', 'CREATE INDEX IF NOT EXISTS FOR (d:Document) ON (d.caseId)'],
  ['Document.documentCategory', 'CREATE INDEX IF NOT EXISTS FOR (d:Document) ON (d.documentCategory)'],
  ['Communication.caseId', 'CREATE INDEX IF NOT EXISTS FOR (com:Communication) ON (com.caseId)'],
  ['Communication.sentAt', 'CREATE INDEX IF NOT EXISTS FOR (com:Communication) ON (com.sentAt)'],
  ['Injury.name', 'CREATE INDEX IF NOT EXISTS FOR (i:Injury) ON (i.name)'],
  ['BodyPart.name', 'CREATE INDEX IF NOT EXISTS FOR (b:BodyPart) ON (b.name)'],
  ['InsuranceCompany.name', 'CREATE INDEX IF NOT EXISTS FOR (ic:InsuranceCompany) ON (ic.name)'],
  ['Expert.name', 'CREATE INDEX IF NOT EXISTS FOR (e:Expert) ON (e.name)'],
  ['StageEvent.occurredAt', 'CREATE INDEX IF NOT EXISTS FOR (se:StageEvent) ON (se.occurredAt)'],
  ['ReadinessSignal.kind', 'CREATE INDEX IF NOT EXISTS FOR (rs:ReadinessSignal) ON (rs.kind)'],
  ['ReadinessCohort.targetStage', 'CREATE INDEX IF NOT EXISTS FOR (rc:ReadinessCohort) ON (rc.targetStage)'],
  ['DocumentChunk.caseId', 'CREATE INDEX IF NOT EXISTS FOR (dc:DocumentChunk) ON (dc.caseId)'],
  ['DocumentChunk.documentId', 'CREATE INDEX IF NOT EXISTS FOR (dc:DocumentChunk) ON (dc.documentId)'],
  ['DocumentChunk.chunkHash', 'CREATE INDEX IF NOT EXISTS FOR (dc:DocumentChunk) ON (dc.chunkHash)'],
  ['EvidenceFact.kind', 'CREATE INDEX IF NOT EXISTS FOR (ef:EvidenceFact) ON (ef.kind)'],
  ['EvidenceFact.caseId', 'CREATE INDEX IF NOT EXISTS FOR (ef:EvidenceFact) ON (ef.caseId)'],
  ['EvidenceFact.numericValue', 'CREATE INDEX IF NOT EXISTS FOR (ef:EvidenceFact) ON (ef.numericValue)'],
  ['EvidenceFact.fromDate', 'CREATE INDEX IF NOT EXISTS FOR (ef:EvidenceFact) ON (ef.fromDate)'],
  ['EvidenceFact.toDate', 'CREATE INDEX IF NOT EXISTS FOR (ef:EvidenceFact) ON (ef.toDate)'],
  ['EvidenceFact.source', 'CREATE INDEX IF NOT EXISTS FOR (ef:EvidenceFact) ON (ef.source)'],
  ['EvidenceFact.extractorVersion', 'CREATE INDEX IF NOT EXISTS FOR (ef:EvidenceFact) ON (ef.extractorVersion)'],
  ['EvidenceFact.chunkHash', 'CREATE INDEX IF NOT EXISTS FOR (ef:EvidenceFact) ON (ef.chunkHash)'],
  ['CaseValuation.caseId', 'CREATE INDEX IF NOT EXISTS FOR (cv:CaseValuation) ON (cv.caseId)'],
];

const FULLTEXT_INDEXES: Array<[string, string]> = [
  [
    'DocumentChunk.fulltext',
    'CREATE FULLTEXT INDEX documentChunkFulltext IF NOT EXISTS FOR (dc:DocumentChunk) ON EACH [dc.text, dc.textPreview, dc.summary]',
  ],
  [
    'EvidenceFact.fulltext',
    'CREATE FULLTEXT INDEX evidenceFactFulltext IF NOT EXISTS FOR (ef:EvidenceFact) ON EACH [ef.label, ef.value, ef.quote]',
  ],
];

async function isAlreadyInitialized(session: ReturnType<typeof createSession>): Promise<boolean> {
  // `npm run setup` invokes `npm run schema` *and* the in-process ingest also
  // calls `ensureGraphSchema` so standalone `npm run ingest` works on a fresh
  // graph. To avoid running ~55 idempotent CREATE...IF NOT EXISTS round-trips
  // on every `setup`, fast-path out if the graph already has at least the
  // expected number of constraints + indexes (full-text indexes show up in
  // SHOW INDEXES with type='FULLTEXT', so we count them separately).
  const constraints = await session.run('SHOW CONSTRAINTS YIELD name RETURN count(*) AS n');
  const constraintCount = Number(constraints.records[0]?.get('n')?.toNumber?.() ?? constraints.records[0]?.get('n') ?? 0);
  if (constraintCount < CONSTRAINTS.length) return false;

  const indexes = await session.run(
    "SHOW INDEXES YIELD name, type WHERE type <> 'FULLTEXT' AND type <> 'LOOKUP' RETURN count(*) AS n"
  );
  const indexCount = Number(indexes.records[0]?.get('n')?.toNumber?.() ?? indexes.records[0]?.get('n') ?? 0);
  if (indexCount < INDEXES.length) return false;

  const fulltext = await session.run("SHOW INDEXES YIELD type WHERE type = 'FULLTEXT' RETURN count(*) AS n");
  const fulltextCount = Number(fulltext.records[0]?.get('n')?.toNumber?.() ?? fulltext.records[0]?.get('n') ?? 0);
  if (fulltextCount < FULLTEXT_INDEXES.length) return false;

  return true;
}

export async function ensureGraphSchema(): Promise<void> {
  await connectNeo4j();
  const session = createSession();
  try {
    if (await isAlreadyInitialized(session)) {
      logger.log('Graph schema already initialized — skipping constraint/index creation');
      return;
    }
    logger.log('Creating constraints...');
    for (const [label, cypher] of CONSTRAINTS) {
      await session.run(cypher);
      logger.log(`✓ ${label} unique constraint`);
    }
    logger.log('\nCreating indexes...');
    for (const [label, cypher] of INDEXES) {
      await session.run(cypher);
      logger.log(`✓ ${label} index`);
    }
    logger.log('\nCreating full-text indexes...');
    for (const [label, cypher] of FULLTEXT_INDEXES) {
      await session.run(cypher);
      logger.log(`✓ ${label} full-text index`);
    }
    logger.log('\nGraph schema initialized');
  } finally {
    await session.close();
  }
}

if (require.main === module) {
  ensureGraphSchema()
    .catch((err) => {
      logger.error('Fatal error:', err instanceof Error ? err.message : err);
      process.exit(1);
    })
    .finally(() => closeNeo4j());
}
