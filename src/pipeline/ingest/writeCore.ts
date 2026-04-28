import type { Db } from 'mongodb';
import type { Session } from 'neo4j-driver';
import {
  MongoContactSchema,
  extractSourceId,
  type MongoContact,
} from '../../types/mongo.types';
import type { CaseNode } from '../../types/graph.types';
import { readCollection } from '../../db/mongo';
import { resolveClientContactId } from './normalize';
import { dedupeContacts, type DedupedContact, type RawContact } from './contactDedup';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Ingest');

const EXCLUDED_CONTACT_TYPES = new Set(['admin', 'system']);

export interface ContactWriteResult {
  deduped: DedupedContact[];
  bySourceId: Map<string, DedupedContact>;
}

export async function writeCases(session: Session, caseNodes: CaseNode[]): Promise<void> {
  logger.log(`\nWriting ${caseNodes.length} Case nodes`);
  const ingestedAt = new Date().toISOString();
  await session.run(
    `
    UNWIND $rows AS row
    MERGE (c:Case {sourceId: row.sourceId})
    SET c.caseId = row.caseId,
        c.caseName = row.caseName,
        c.caseNumber = row.caseNumber,
        c.caseType = row.caseType,
        c.legalStage = row.legalStage,
        c.subStage = row.subStage,
        c.phase = row.phase,
        c.status = row.status,
        c.isSigned = row.isSigned,
        c.createdAt = row.createdAt,
        c.eventDate = row.eventDate,
        c.signedAt = row.signedAt,
        c.legalStageEnteredAt = row.legalStageEnteredAt,
        c.updatedAt = row.updatedAt,
        c.completionRate = row.completionRate,
        c.missingCritical = row.missingCritical,
        c.monthsSinceEvent = row.monthsSinceEvent,
        c.isOverdue = row.isOverdue,
        c.mainInjury = row.mainInjury,
        c.aiGeneratedSummary = row.aiGeneratedSummary,
        c.slaStatus = row.slaStatus,
        c.slaForCurrentStage = row.slaForCurrentStage,
        c.slaDetails = row.slaDetails,
        c.daysInCurrentStage = row.daysInCurrentStage,
        c.expectedCompletionDate = row.expectedCompletionDate,
        c.ingestedAt = datetime($ingestedAt)
    `,
    { rows: caseNodes, ingestedAt }
  );
  await session.run(
    `MERGE (m:IngestRun {key: 'singleton'}) SET m.lastSuccessfulAt = datetime($ingestedAt)`,
    { ingestedAt }
  );
}

function toRawContact(c: MongoContact): RawContact {
  return {
    sourceId: extractSourceId(c._id),
    name: c.name,
    contactType: c.contactType,
    phone: c.phone ?? null,
    email: c.email ?? null,
    caseIds: [...(c.caseIds ?? [])],
  };
}

export async function writeContactsAndClients(
  session: Session,
  db: Db,
  fetchLimit: number,
  caseNodes: CaseNode[],
  caseIds: Set<string>
): Promise<ContactWriteResult> {
  logger.log('\nWriting Contact nodes + HAS_CONTACT edges (deduped)');
  const mongoContacts = await readCollection(db, 'contacts', MongoContactSchema, {}, { limit: fetchLimit });
  const allowedContacts = mongoContacts.filter((c) => !EXCLUDED_CONTACT_TYPES.has(c.contactType));
  const skipped = mongoContacts.length - allowedContacts.length;
  if (skipped > 0) logger.log(`Skipped ${skipped} admin/system contacts`);

  const deduped = dedupeContacts(allowedContacts.map(toRawContact));
  const mergeCount = allowedContacts.length - deduped.length;
  if (mergeCount > 0) logger.log(`Merged ${mergeCount} duplicate contact rows`);

  const contactRows = deduped.map((c) => ({
    dedupKey: c.dedupKey,
    name: c.name,
    normalizedName: c.normalizedName,
    contactType: c.contactType,
    phone: c.phone,
    email: c.email,
    hasPhone: Boolean(c.phone),
    hasEmail: Boolean(c.email),
    sourceIds: c.sourceIds,
  }));
  await session.run(
    `
    UNWIND $rows AS row
    MERGE (con:Contact {dedupKey: row.dedupKey})
	 SET con.name = row.name,
	     con.normalizedName = row.normalizedName,
	     con.contactType = row.contactType,
	     con.phone = row.phone,
	     con.email = row.email,
	     con.hasPhone = row.hasPhone,
	     con.hasEmail = row.hasEmail,
	     con.sourceIds = row.sourceIds
    `,
    { rows: contactRows }
  );

  const hasContactRows: Array<{ caseId: string; dedupKey: string; role: string }> = [];
  for (const c of deduped) {
    for (const cid of c.caseIds) {
      if (caseIds.has(cid)) hasContactRows.push({ caseId: cid, dedupKey: c.dedupKey, role: c.contactType });
    }
  }
  await session.run(
    `
    UNWIND $rows AS row
    MATCH (c:Case {caseId: row.caseId}), (con:Contact {dedupKey: row.dedupKey})
    MERGE (c)-[r:HAS_CONTACT]->(con)
    SET r.role = row.role
    `,
    { rows: hasContactRows }
  );
  logger.log(`Wrote ${contactRows.length} Contact nodes, ${hasContactRows.length} HAS_CONTACT edges`);

  const bySourceId = new Map<string, DedupedContact>();
  for (const c of deduped) {
    for (const sid of c.sourceIds) bySourceId.set(sid, c);
  }

  const hasClientRows: Array<{ caseId: string; dedupKey: string }> = [];
  for (const node of caseNodes) {
    const clientSourceId = resolveClientContactId(node, allowedContacts);
    if (clientSourceId) {
      const merged = bySourceId.get(clientSourceId);
      if (merged) hasClientRows.push({ caseId: node.caseId, dedupKey: merged.dedupKey });
    }
  }
  await session.run(
    `
    UNWIND $rows AS row
    MATCH (c:Case {caseId: row.caseId}), (con:Contact {dedupKey: row.dedupKey})
    MERGE (c)-[:HAS_CLIENT]->(con)
    `,
    { rows: hasClientRows }
  );
  logger.log(`Wrote ${hasClientRows.length} HAS_CLIENT edges`);

  return { deduped, bySourceId };
}
