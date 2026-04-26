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
];

const INDEXES: Array<[string, string]> = [
  ['Case.caseId', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.caseId)'],
  ['Case.caseNumber', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.caseNumber)'],
  ['Case.caseType', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.caseType)'],
  ['Case.legalStage', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.legalStage)'],
  ['Case.subStage', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.subStage)'],
  ['Case.phase', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.phase)'],
  ['Case.completionRate', 'CREATE INDEX IF NOT EXISTS FOR (c:Case) ON (c.completionRate)'],
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
];

export async function ensureGraphSchema(): Promise<void> {
  await connectNeo4j();
  const session = createSession();
  try {
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
