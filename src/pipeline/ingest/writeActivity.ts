import type { Db } from 'mongodb';
import type { Session } from 'neo4j-driver';
import { MongoActivityLogSchema, extractISODate, extractSourceId } from '../../types/mongo.types';
import { readCollection } from '../../db/mongo';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Ingest');

const STAGE_FIELDS = ['toStage', 'to', 'newStage', 'stage'] as const;
const SUB_STAGE_FIELDS = ['toSubStage', 'subStage', 'newSubStage'] as const;

function readString(
  details: Record<string, unknown>,
  fields: readonly string[]
): string | null {
  for (const field of fields) {
    const value = details[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function extractStatusFromChanges(details: Record<string, unknown>): string | null {
  const changes = details.changes;
  if (!changes || typeof changes !== 'object') return null;
  const c = changes as Record<string, unknown>;
  // Hebrew "סטטוס" or English "status" — pick the .to value
  for (const key of Object.keys(c)) {
    const entry = c[key];
    if (entry && typeof entry === 'object' && 'to' in entry) {
      const to = (entry as { to: unknown }).to;
      if (typeof to === 'string') return to;
    }
  }
  return null;
}

export async function writeReachedStages(
  session: Session,
  db: Db,
  caseIds: Set<string>
): Promise<void> {
  logger.log('\nWriting ActivityEvent + StageEvent nodes');
  const activityLogs = await readCollection(
    db,
    'case_activity_log',
    MongoActivityLogSchema,
    {},
    { limit: 0 }
  );

  const activityRows: Array<Record<string, unknown>> = [];
  const stageRows: Array<Record<string, unknown>> = [];

  for (const entry of activityLogs) {
    if (!caseIds.has(entry.caseId)) continue;
    const sourceId = extractSourceId(entry._id);
    const at = extractISODate(entry.timestamp);
    const details = entry.details ?? {};
    activityRows.push({
      sourceId,
      caseId: entry.caseId,
      category: entry.category ?? null,
      action: entry.action,
      summary: entry.summary ?? null,
      at,
      source: entry.source ?? null,
      userName: entry.userName ?? null,
      // Instruction events: capture due date and assignee for SLA queries
      dueDate: extractISODate(details.dueDate),
      // Reminder events: capture target date
      targetDate: extractISODate(details.targetDate),
      assigneeName: typeof details.assigneeName === 'string' ? details.assigneeName : null,
      // Document generation events
      documentType: typeof details.documentType === 'string' ? details.documentType : null,
      documentCategory:
        typeof details.documentCategory === 'string' ? details.documentCategory : null,
      fileName: typeof details.fileName === 'string' ? details.fileName : null,
      // Status transitions (e.g. "לא הושלם" -> "הושלם")
      status: extractStatusFromChanges(details),
    });

    if (entry.action !== 'stage_changed' || !at) continue;
    const stageName = readString(details, STAGE_FIELDS);
    if (!stageName) continue;
    const subStage = readString(details, SUB_STAGE_FIELDS);
    stageRows.push({
      key: `${sourceId}:${stageName}:${subStage ?? ''}`,
      caseId: entry.caseId,
      stageName,
      subStage,
      occurredAt: at,
      source: 'activity_log',
    });
  }

  await session.run(
    `UNWIND $rows AS row
     MERGE (ae:ActivityEvent {sourceId: row.sourceId})
     SET ae.caseId = row.caseId,
         ae.category = row.category,
         ae.action = row.action,
         ae.summary = row.summary,
         ae.at = CASE WHEN row.at IS NULL THEN null ELSE datetime(row.at) END,
         ae.source = row.source,
         ae.userName = row.userName,
         ae.dueDate = CASE WHEN row.dueDate IS NULL THEN null ELSE datetime(row.dueDate) END,
         ae.targetDate = CASE WHEN row.targetDate IS NULL THEN null ELSE datetime(row.targetDate) END,
         ae.assigneeName = row.assigneeName,
         ae.documentType = row.documentType,
         ae.documentCategory = row.documentCategory,
         ae.fileName = row.fileName,
         ae.status = row.status`,
    { rows: activityRows }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (ae:ActivityEvent {sourceId: row.sourceId})
     MERGE (c)-[:HAS_ACTIVITY]->(ae)`,
    { rows: activityRows.map((row) => ({ caseId: row.caseId, sourceId: row.sourceId })) }
  );
  await session.run(`UNWIND $rows AS row MERGE (:Stage {name: row.stageName})`, { rows: stageRows });
  await session.run(
    `UNWIND $rows AS row
     MERGE (se:StageEvent {key: row.key})
     SET se.caseId = row.caseId,
         se.stageName = row.stageName,
         se.subStage = row.subStage,
         se.occurredAt = datetime(row.occurredAt),
         se.source = row.source`,
    { rows: stageRows }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (se:StageEvent {key: row.key}), (s:Stage {name: row.stageName})
     MERGE (c)-[:HAS_STAGE_EVENT]->(se)
     MERGE (se)-[:FOR_STAGE]->(s)
     MERGE (c)-[r:REACHED_STAGE {stage: row.stageName}]->(s)
     SET r.at = datetime(row.occurredAt),
         r.source = row.source`,
    { rows: stageRows }
  );
  logger.log(
    `Wrote ${activityRows.length} ActivityEvents and ${stageRows.length} StageEvents`
  );
}

export async function backfillCurrentStageEvents(session: Session): Promise<void> {
  logger.log('\nBackfilling synthetic StageEvents from c.legalStage + c.legalStageEnteredAt');
  const result = await session.run(`
    MATCH (c:Case)
    WHERE c.legalStage IS NOT NULL
      AND c.legalStageEnteredAt IS NOT NULL
      AND NOT EXISTS {
        MATCH (c)-[:HAS_STAGE_EVENT]->(se:StageEvent)
        WHERE se.stageName = c.legalStage
      }
    RETURN c.caseId AS caseId,
           c.legalStage AS stageName,
           toString(c.legalStageEnteredAt) AS occurredAt
  `);

  const rows = result.records.map((r) => {
    const caseId = r.get('caseId') as string;
    const stageName = r.get('stageName') as string;
    return {
      caseId,
      stageName,
      occurredAt: r.get('occurredAt') as string,
      key: `legalStageBackfill:${caseId}:${stageName}`,
    };
  });

  if (rows.length === 0) {
    logger.log('No backfill needed');
    return;
  }

  await session.run(`UNWIND $rows AS row MERGE (:Stage {name: row.stageName})`, { rows });
  await session.run(
    `UNWIND $rows AS row
     MERGE (se:StageEvent {key: row.key})
     SET se.caseId = row.caseId,
         se.stageName = row.stageName,
         se.subStage = null,
         se.occurredAt = datetime(row.occurredAt),
         se.source = 'current_stage_snapshot'`,
    { rows }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (se:StageEvent {key: row.key}), (s:Stage {name: row.stageName})
     MERGE (c)-[:HAS_STAGE_EVENT]->(se)
     MERGE (se)-[:FOR_STAGE]->(s)
     MERGE (c)-[r:REACHED_STAGE {stage: row.stageName}]->(s)
     SET r.at = datetime(row.occurredAt),
         r.source = 'current_stage_snapshot'`,
    { rows }
  );
  logger.log(`Backfilled ${rows.length} synthetic StageEvents`);
}
