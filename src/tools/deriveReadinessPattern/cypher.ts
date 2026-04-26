import { z } from 'zod';
import {
  neo4jNullableNumber,
  neo4jNumber,
  neo4jString,
} from '@/tools/_shared/neo4jMap';
import type { QueryMeta } from '@/tools/_shared/runReadQueryWithMeta';

export const COMMON_SIGNAL_CYPHER = `
  MATCH (rc:ReadinessCohort {key: $cohortKey})-[rel:COMMON_SIGNAL]->(rs:ReadinessSignal)
  RETURN rs.key AS signalKey,
         rs.label AS label,
         rs.kind AS kind,
         rel.support AS support,
         rel.lift AS lift,
         rel.weight AS weight,
         rel.medianLeadDays AS medianLeadDays
  ORDER BY rel.weight DESC, rs.label ASC
`;

const STAGE_REACH_CYPHER =
  'MATCH (:Case)-[:HAS_STAGE_EVENT]->(se:StageEvent)-[:FOR_STAGE]->(:Stage {name: $targetStage}) RETURN count(DISTINCT se.caseId) AS historicalPeerCount';

export const signalRowSchema = z.object({
  signalKey: neo4jString,
  label: neo4jString,
  kind: neo4jString,
  support: neo4jNumber,
  lift: neo4jNumber,
  weight: neo4jNumber,
  medianLeadDays: neo4jNullableNumber,
});

export type CommonSignal = z.output<typeof signalRowSchema>;

export function stageReachMeta(targetStage: string, targetSubStage: string | null): QueryMeta {
  return {
    cypher: STAGE_REACH_CYPHER,
    params: { targetStage, targetSubStage },
    rowCount: 1,
  };
}
