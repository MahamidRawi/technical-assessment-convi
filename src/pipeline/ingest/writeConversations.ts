import type { Db } from 'mongodb';
import type { Session } from 'neo4j-driver';
import {
  MongoConversationSchema,
  extractISODate,
  extractSourceId,
  type MongoConversation,
} from '../../types/mongo.types';
import type { ConversationNode } from '../../types/graph.types';
import { readCollection } from '../../db/mongo';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Ingest');

function buildConversationNode(entry: MongoConversation): ConversationNode {
  const sourceId = extractSourceId(entry._id);
  const triage = entry.triageSummary ?? null;
  const checks = triage?.thresholdChecks ?? null;
  const thresholdEntries: string[] = [];
  let allPass: boolean | null = null;
  if (checks) {
    const values = Object.entries(checks);
    if (values.length > 0) {
      let sawScored = false;
      let allPassSoFar = true;
      for (const [key, value] of values) {
        thresholdEntries.push(`${key}:${value}`);
        if (value === 'PASS' || value === 'FAIL') {
          sawScored = true;
          if (value !== 'PASS') allPassSoFar = false;
        }
      }
      allPass = sawScored ? allPassSoFar : null;
    }
  }
  return {
    sourceId,
    caseId: entry.caseId,
    sessionId: entry.sessionId ?? null,
    userName: entry.userName ?? null,
    caseType: entry.caseType ?? null,
    caseStatus: entry.caseStatus ?? null,
    status: entry.status ?? null,
    messageCount: entry.messageCount ?? 0,
    lastAgentUsed: entry.lastAgentUsed ?? null,
    routingReason: entry.routingReason ?? null,
    workAccidentFlag: entry.workAccidentFlag ?? null,
    createdAt: extractISODate(entry.createdAt),
    lastActivity: extractISODate(entry.lastActivity),
    triageCompletedAt: extractISODate(entry.triageCompletedAt),
    submittedForReviewAt: extractISODate(entry.submittedForReviewAt),
    lastSummarizedAt: extractISODate(entry.lastSummarizedAt),
    accidentDate: triage?.accidentDate ?? null,
    accidentType: triage?.accidentType ?? null,
    medicalTreatment: triage?.medicalTreatment ?? null,
    currentStatus: triage?.currentStatus ?? null,
    thresholdChecks: thresholdEntries,
    thresholdAllPass: allPass,
  };
}

export async function writeConversations(
  session: Session,
  db: Db,
  caseIds: Set<string>
): Promise<void> {
  logger.log('\nWriting Conversation nodes + HAS_CONVERSATION edges');
  const conversations = await readCollection(
    db,
    'conversations',
    MongoConversationSchema,
    {},
    { limit: 0 }
  );

  const rows: ConversationNode[] = [];
  for (const entry of conversations) {
    if (!caseIds.has(entry.caseId)) continue;
    rows.push(buildConversationNode(entry));
  }

  if (rows.length === 0) {
    logger.log('No conversations to write');
    return;
  }

  await session.run(
    `UNWIND $rows AS row
     MERGE (cv:Conversation {sourceId: row.sourceId})
     SET cv.caseId = row.caseId,
         cv.sessionId = row.sessionId,
         cv.userName = row.userName,
         cv.caseType = row.caseType,
         cv.caseStatus = row.caseStatus,
         cv.status = row.status,
         cv.messageCount = row.messageCount,
         cv.lastAgentUsed = row.lastAgentUsed,
         cv.routingReason = row.routingReason,
         cv.workAccidentFlag = row.workAccidentFlag,
         cv.createdAt = CASE WHEN row.createdAt IS NULL THEN null ELSE datetime(row.createdAt) END,
         cv.lastActivity = CASE WHEN row.lastActivity IS NULL THEN null ELSE datetime(row.lastActivity) END,
         cv.triageCompletedAt = CASE WHEN row.triageCompletedAt IS NULL THEN null ELSE datetime(row.triageCompletedAt) END,
         cv.submittedForReviewAt = CASE WHEN row.submittedForReviewAt IS NULL THEN null ELSE datetime(row.submittedForReviewAt) END,
         cv.lastSummarizedAt = CASE WHEN row.lastSummarizedAt IS NULL THEN null ELSE datetime(row.lastSummarizedAt) END,
         cv.accidentDate = row.accidentDate,
         cv.accidentType = row.accidentType,
         cv.medicalTreatment = row.medicalTreatment,
         cv.currentStatus = row.currentStatus,
         cv.thresholdChecks = row.thresholdChecks,
         cv.thresholdAllPass = row.thresholdAllPass`,
    { rows }
  );

  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (cv:Conversation {sourceId: row.sourceId})
     MERGE (c)-[:HAS_CONVERSATION]->(cv)`,
    { rows: rows.map((r) => ({ caseId: r.caseId, sourceId: r.sourceId })) }
  );

  logger.log(`Wrote ${rows.length} Conversation nodes`);
}
