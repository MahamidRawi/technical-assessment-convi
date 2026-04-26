import { z } from 'zod';
import { runReadQuery } from './_shared/runReadQuery';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jNullableDateTimeString,
  neo4jNumber,
  neo4jString,
} from './_shared/neo4jMap';
import { assertStageExists } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface StageTransitionRankRow {
  caseId: string;
  caseName: string;
  caseType: string;
  eventDate: string | null;
  stageOccurredAt: string;
  daysFromEventToStage: number;
  timingSource: string;
}

export interface StageTransitionRankResult {
  targetStage: string;
  hits: StageTransitionRankRow[];
  excludedMissingTimingCount: number;
  /**
   * True when every returned hit was timed from a current_stage_snapshot
   * (i.e., Case.legalStageEnteredAt) rather than a parsed activity-log
   * transition. In that case daysFromEventToStage measures case age at
   * stage entry, not transition duration. The agent must caveat the answer.
   */
  allTimingFromSnapshotOnly: boolean;
  activityLogHitCount: number;
  snapshotHitCount: number;
  meta: QueryMeta;
}

const inputSchema = z.object({
  targetStage: z
    .string()
    .describe('Exact Stage name to rank by explicit transition timing, e.g. file_claim.'),
  limit: z.number().int().min(1).max(50).default(10),
});

type Input = z.infer<typeof inputSchema>;

const rowSchema = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseType: neo4jString,
  eventDate: neo4jNullableDateTimeString,
  stageOccurredAt: neo4jString,
  daysFromEventToStage: neo4jNumber,
  timingSource: neo4jString,
});

const countRowSchema = z.object({
  excludedMissingTimingCount: neo4jNumber,
});

const timingBaseCypher = `
  MATCH (c:Case)
  OPTIONAL MATCH (c)-[r:REACHED_STAGE]->(:Stage {name: $targetStage})
  WITH c, r
  ORDER BY r.at ASC
  WITH c, head(collect(r)) AS reached
  WITH c, reached.at AS reachedAt, reached.source AS reachedSource
  WHERE c.legalStage = $targetStage OR reachedAt IS NOT NULL
  WITH c,
       CASE
         WHEN reachedAt IS NOT NULL THEN reachedAt
         WHEN c.legalStage = $targetStage AND c.legalStageEnteredAt IS NOT NULL
           THEN datetime(c.legalStageEnteredAt)
         ELSE null
       END AS stageAt,
       CASE
         WHEN reachedAt IS NOT NULL THEN
           CASE coalesce(reachedSource, 'unknown_reached_stage')
             WHEN 'legalStageBackfill' THEN 'current_stage_snapshot'
             ELSE coalesce(reachedSource, 'unknown_reached_stage')
           END
         WHEN c.legalStage = $targetStage AND c.legalStageEnteredAt IS NOT NULL
           THEN 'current_stage_snapshot'
         ELSE null
       END AS timingSource
  WITH c, stageAt, timingSource,
       CASE
         WHEN c.eventDate IS NOT NULL AND stageAt IS NOT NULL
           THEN duration.inDays(datetime(c.eventDate), stageAt).days
         ELSE null
       END AS daysFromEventToStage
`;

async function execute({ targetStage, limit }: Input): Promise<StageTransitionRankResult> {
  await assertStageExists(targetStage);
  const cypher = `
    ${timingBaseCypher}
    WHERE daysFromEventToStage IS NOT NULL
    RETURN c.caseId AS caseId,
           c.caseName AS caseName,
           c.caseType AS caseType,
           c.eventDate AS eventDate,
           toString(stageAt) AS stageOccurredAt,
           daysFromEventToStage,
           timingSource
    ORDER BY daysFromEventToStage ASC, c.caseName ASC
    LIMIT toInteger($limit)
  `;
  const excludedCypher = `
    ${timingBaseCypher}
    WHERE daysFromEventToStage IS NULL
    RETURN count(c) AS excludedMissingTimingCount
  `;
  const [{ rows, meta }, excludedRows] = await Promise.all([
    runReadQueryWithMeta(cypher, { targetStage, limit }, rowSchema),
    runReadQuery(excludedCypher, { targetStage }, countRowSchema),
  ]);

  const activityLogHitCount = rows.filter((row) => row.timingSource === 'activity_log').length;
  const snapshotHitCount = rows.length - activityLogHitCount;

  return {
    targetStage,
    hits: rows,
    excludedMissingTimingCount: excludedRows[0]?.excludedMissingTimingCount ?? 0,
    allTimingFromSnapshotOnly: rows.length > 0 && activityLogHitCount === 0,
    activityLogHitCount,
    snapshotHitCount,
    meta,
  };
}

export const rankCasesByStageTransitionTimeTool: ToolDefinition<
  typeof inputSchema,
  StageTransitionRankResult
> = {
  name: 'rankCasesByStageTransitionTime',
  label: 'Ranking stage transition timing',
  inputSchema,
  execute,
  summarize: (result) => {
    if (result.hits.length === 0) {
      return `No cases with explicit timing for ${result.targetStage}`;
    }
    const provenance = result.allTimingFromSnapshotOnly
      ? ' (snapshot-only: all timings are case-age-at-stage-entry, not measured transitions)'
      : result.snapshotHitCount > 0
        ? ` (${result.activityLogHitCount} activity-log, ${result.snapshotHitCount} snapshot)`
        : '';
    return `${result.hits.length} timed cases for ${result.targetStage}${provenance}; ${result.excludedMissingTimingCount} excluded without timing`;
  },
  extractEvidence: (result) =>
    result.hits.map((hit) => ({
      sourceType: 'Case' as const,
      sourceId: hit.caseId,
      label: `${hit.caseName}: ${hit.daysFromEventToStage} days`,
      viaTool: 'rankCasesByStageTransitionTime',
    })),
  traceMeta: (result) => result.meta,
};
