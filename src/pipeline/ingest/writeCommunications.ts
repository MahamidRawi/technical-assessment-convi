import type { Db } from 'mongodb';
import type { Session } from 'neo4j-driver';
import {
  MongoCommunicationSchema,
  extractISODate,
  extractSourceId,
  type MongoCommunication,
} from '../../types/mongo.types';
import { readCollection } from '../../db/mongo';
import { normalizeContactName } from './normalize';
import type { ContactWriteResult } from './writeCore';
import { buildContactDedupKey } from './contactDedup';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Ingest');

interface ContactNodeRow {
  dedupKey: string;
  name: string;
  normalizedName: string;
  contactType: string;
  phone: string | null;
  email: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  sourceIds: string[];
}

interface CommunicationRow {
  sourceId: string;
  caseId: string;
  type: string;
  direction: string;
  status: string;
  sentAt: string | null;
  subject: string;
  textPreview: string;
  fromName: string;
}

interface ParticipantEdgeRow {
  commId: string;
  dedupKey: string;
  kind: 'FROM_CONTACT' | 'TO_CONTACT' | 'CC_CONTACT';
}

interface CommunicationParticipant {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  contactId?: string | null;
}

function participantLabel(p: {
  name?: string | null;
}): string {
  return p.name?.trim() || 'Unknown';
}

function createParticipantRow(
  participant: CommunicationParticipant,
  fallbackSourceId: string,
  contacts: ContactWriteResult
): ContactNodeRow | null {
  const sourceId = participant.contactId?.trim() || fallbackSourceId;
  const linked = participant.contactId ? contacts.bySourceId.get(participant.contactId) : null;
  if (linked) {
    return {
      dedupKey: linked.dedupKey,
      name: linked.name,
      normalizedName: linked.normalizedName,
      contactType: linked.contactType,
      phone: linked.phone,
      email: linked.email,
      hasPhone: Boolean(linked.phone),
      hasEmail: Boolean(linked.email),
      sourceIds: linked.sourceIds,
    };
  }
  const row = {
    sourceId,
    name: participantLabel(participant),
    contactType: 'communication_party',
    phone: participant.phone ?? null,
    email: participant.email ?? null,
  };
  return {
    dedupKey: buildContactDedupKey(row),
    name: row.name,
    normalizedName: normalizeContactName(row.name),
    contactType: row.contactType,
    phone: row.phone,
    email: row.email,
    hasPhone: Boolean(row.phone),
    hasEmail: Boolean(row.email),
    sourceIds: [row.sourceId],
  };
}

export async function writeCommunications(
  session: Session,
  db: Db,
  fetchLimit: number,
  caseIds: Set<string>,
  contacts: ContactWriteResult
): Promise<void> {
  logger.log('\nWriting Communication nodes + participant edges');
  const mongoComms = await readCollection(
    db,
    'communications',
    MongoCommunicationSchema,
    {},
    { limit: fetchLimit }
  );
  const commRows: CommunicationRow[] = [];
  const contactRows = new Map<string, ContactNodeRow>();
  const participantRows: ParticipantEdgeRow[] = [];

  const addParticipant = (
    comm: MongoCommunication,
    participant: CommunicationParticipant,
    kind: ParticipantEdgeRow['kind'],
    index: number
  ): void => {
    const commId = extractSourceId(comm._id);
    const row = createParticipantRow(participant, `${commId}:${kind}:${index}`, contacts);
    if (!row) return;
    contactRows.set(row.dedupKey, row);
    participantRows.push({ commId, dedupKey: row.dedupKey, kind });
  };

  for (const comm of mongoComms) {
    if (!caseIds.has(comm.caseId)) continue;
    const sourceId = extractSourceId(comm._id);
    const sentAt = extractISODate(comm.sentAt) ?? extractISODate(comm.createdAt);
    commRows.push({
      sourceId,
      caseId: comm.caseId,
      type: comm.type ?? 'unknown',
      direction: comm.direction ?? 'unknown',
      status: comm.status ?? 'unknown',
      sentAt,
      subject: (comm.subject ?? '').slice(0, 200),
      textPreview: (comm.bodyText ?? comm.summary ?? comm.ocrText ?? '').slice(0, 500),
      fromName: participantLabel(comm.from ?? {}),
    });
    if (comm.from) addParticipant(comm, comm.from, 'FROM_CONTACT', 0);
    (comm.to ?? []).forEach((p, index) => addParticipant(comm, p, 'TO_CONTACT', index));
    (comm.cc ?? []).forEach((p, index) => addParticipant(comm, p, 'CC_CONTACT', index));
  }

  await session.run(
    `UNWIND $rows AS row
     MERGE (com:Communication {sourceId: row.sourceId})
     SET com.caseId = row.caseId,
         com.type = row.type,
         com.direction = row.direction,
         com.status = row.status,
         com.sentAt = CASE WHEN row.sentAt IS NULL THEN null ELSE datetime(row.sentAt) END,
	         com.subject = row.subject,
	         com.textPreview = row.textPreview,
	         com.fromName = row.fromName,
	         com.transcript = null,
	         com.language = "he"`,
    { rows: commRows }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (com:Communication {sourceId: row.sourceId})
     MERGE (c)-[:HAS_COMMUNICATION]->(com)`,
    { rows: commRows.map((row) => ({ caseId: row.caseId, sourceId: row.sourceId })) }
  );
  await session.run(
    `UNWIND $rows AS row
     MERGE (con:Contact {dedupKey: row.dedupKey})
	 SET con.name = row.name,
	     con.normalizedName = row.normalizedName,
	     con.contactType = row.contactType,
	     con.phone = row.phone,
	     con.email = row.email,
	     con.hasPhone = row.hasPhone,
	     con.hasEmail = row.hasEmail,
	     con.sourceIds = row.sourceIds`,
    { rows: Array.from(contactRows.values()) }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (com:Communication {sourceId: row.commId}), (con:Contact {dedupKey: row.dedupKey})
     FOREACH (_ IN CASE WHEN row.kind = 'FROM_CONTACT' THEN [1] ELSE [] END | MERGE (com)-[:FROM_CONTACT]->(con))
     FOREACH (_ IN CASE WHEN row.kind = 'TO_CONTACT' THEN [1] ELSE [] END | MERGE (com)-[:TO_CONTACT]->(con))
     FOREACH (_ IN CASE WHEN row.kind = 'CC_CONTACT' THEN [1] ELSE [] END | MERGE (com)-[:CC_CONTACT]->(con))`,
    { rows: participantRows }
  );
  logger.log(`Wrote ${commRows.length} Communications with ${participantRows.length} participant edges`);
}
