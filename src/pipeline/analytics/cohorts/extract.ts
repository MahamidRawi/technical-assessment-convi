import { z } from 'zod';
import { neo4jNullableString, neo4jString } from '@/tools/_shared/neo4jMap';
import { parseNeo4jRecords } from '../neo4jRows';
import type { CaseSignal, CohortInputs, CohortReadRunner } from './types';

const caseInfoRowSchema = z.object({
  caseId: neo4jString,
  caseType: neo4jString,
  eventDate: neo4jNullableString,
});

const stageReachRowSchema = z.object({
  caseId: neo4jString,
  caseType: neo4jString,
  stageName: neo4jString,
  subStage: neo4jNullableString,
  occurredAt: neo4jString,
  source: neo4jString,
});

const caseSignalRowSchema = z.object({
  caseId: neo4jString,
  signalKey: neo4jString,
  firstObservedAt: neo4jNullableString,
});

function caseSignalMap(
  rows: Array<z.output<typeof caseSignalRowSchema>>
): Map<string, CaseSignal[]> {
  const out = new Map<string, CaseSignal[]>();
  for (const row of rows) {
    const list = out.get(row.caseId) ?? [];
    list.push({ signalKey: row.signalKey, firstObservedAt: row.firstObservedAt });
    out.set(row.caseId, list);
  }
  return out;
}

export async function loadCohortInputs(session: CohortReadRunner): Promise<CohortInputs> {
  const casesResult = await session.run(`
      MATCH (c:Case)
      RETURN c.caseId AS caseId, c.caseType AS caseType, toString(c.eventDate) AS eventDate
    `);
  const stageResult = await session.run(`
      MATCH (c:Case)-[:HAS_STAGE_EVENT]->(se:StageEvent)-[:FOR_STAGE]->(s:Stage)
      WITH c, s, se.subStage AS subStage, min(se.occurredAt) AS occurredAt,
           collect(DISTINCT se.source) AS sources
      RETURN c.caseId AS caseId,
             c.caseType AS caseType,
             s.name AS stageName,
             subStage,
             toString(occurredAt) AS occurredAt,
             CASE coalesce(head([source IN sources WHERE source IS NOT NULL]), 'unknown_stage_event')
               WHEN 'legalStageBackfill' THEN 'current_stage_snapshot'
               ELSE coalesce(head([source IN sources WHERE source IS NOT NULL]), 'unknown_stage_event')
             END AS source
    `);
  const signalResult = await session.run(`
      MATCH (c:Case)-[hs:HAS_SIGNAL]->(rs:ReadinessSignal)
      RETURN c.caseId AS caseId, rs.key AS signalKey, toString(hs.firstObservedAt) AS firstObservedAt
    `);

  const caseRows = parseNeo4jRecords(casesResult.records, caseInfoRowSchema, 'cohort cases');
  const signalRows = parseNeo4jRecords(signalResult.records, caseSignalRowSchema, 'cohort signals');

  return {
    cases: new Map(caseRows.map((row) => [row.caseId, row])),
    reaches: parseNeo4jRecords(stageResult.records, stageReachRowSchema, 'cohort stages'),
    signalsByCase: caseSignalMap(signalRows),
  };
}
