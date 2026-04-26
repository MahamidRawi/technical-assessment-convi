import { z } from 'zod';
import { neo4jNullableNumber, neo4jNumber, neo4jString } from '@/tools/_shared/neo4jMap';

export const estimateRowSchema = z.object({
  peerCaseId: neo4jString,
  similarityScore: neo4jNumber,
  totalDaysToStage: neo4jNullableNumber,
  timingSource: neo4jString,
});

export type EstimateRow = z.output<typeof estimateRowSchema>;

/** Cohort path: pulls timing-rich peers ranked by similarity to the seed case. */
export const COHORT_TIMING_CYPHER = `
  MATCH (rc:ReadinessCohort {key: $cohortKey})-[:HAS_MEMBER]->(peer:Case)
  MATCH (peer)-[:HAS_STAGE_EVENT]->(se:StageEvent)-[:FOR_STAGE]->(s:Stage {name: $targetStage})
  OPTIONAL MATCH (c:Case {caseId: $caseId})-[sim:SIMILAR_TO]->(peer)
  WHERE coalesce(se.subStage, '') = coalesce($targetSubStage, '')
  RETURN peer.caseId AS peerCaseId,
         coalesce(sim.score, 0.0) AS similarityScore,
         CASE
           WHEN peer.eventDate IS NULL THEN null
           ELSE duration.inDays(datetime(peer.eventDate), se.occurredAt).days
         END AS totalDaysToStage,
         CASE coalesce(se.source, 'unknown_stage_event')
           WHEN 'legalStageBackfill' THEN 'current_stage_snapshot'
           ELSE coalesce(se.source, 'unknown_stage_event')
         END AS timingSource
  ORDER BY similarityScore DESC, peer.caseId ASC
  LIMIT toInteger($limit)
`;

/** Sparse-stage fallback: any peer that reached the stage, ordered by speed. */
export const SPARSE_STAGE_TIMING_CYPHER = `
  MATCH (peer:Case)
  WHERE peer.caseId <> $caseId
  OPTIONAL MATCH (peer)-[r:REACHED_STAGE]->(:Stage {name: $targetStage})
  WITH peer,
       min(r.at) AS reachedAt,
       collect(DISTINCT r.source) AS reachedSources
  WHERE peer.legalStage = $targetStage OR reachedAt IS NOT NULL
  WITH peer,
       CASE
         WHEN reachedAt IS NOT NULL THEN reachedAt
         WHEN peer.legalStage = $targetStage AND peer.legalStageEnteredAt IS NOT NULL
           THEN datetime(peer.legalStageEnteredAt)
         ELSE null
       END AS stageAt,
       CASE
         WHEN reachedAt IS NOT NULL THEN
           CASE coalesce(head([source IN reachedSources WHERE source IS NOT NULL]), 'unknown_reached_stage')
             WHEN 'legalStageBackfill' THEN 'current_stage_snapshot'
             ELSE coalesce(head([source IN reachedSources WHERE source IS NOT NULL]), 'unknown_reached_stage')
           END
         WHEN peer.legalStage = $targetStage AND peer.legalStageEnteredAt IS NOT NULL
           THEN 'current_stage_snapshot'
         ELSE 'unknown'
       END AS timingSource
  WHERE stageAt IS NOT NULL
    AND peer.eventDate IS NOT NULL
  RETURN peer.caseId AS peerCaseId,
         1.0 AS similarityScore,
         duration.inDays(datetime(peer.eventDate), stageAt).days AS totalDaysToStage,
         timingSource
  ORDER BY totalDaysToStage ASC, peer.caseId ASC
  LIMIT toInteger($limit)
`;
