import { z } from 'zod';
import { runReadQuery } from '@/tools/_shared/runReadQuery';
import {
  neo4jBoolean,
  neo4jNullableNumber,
  neo4jNullableString,
  neo4jNumber,
  neo4jString,
  neo4jStringArray,
} from '@/tools/_shared/neo4jMap';
import { NoGlobalReadinessCohortError, NoReadinessCohortError } from './errors';
import { thinSameTypeContextUsed, type SelectedCohort, type TargetCaseSummary } from './shared';
import { countStageReaches, resolveTargetCase } from './targetCase';

const cohortRow = z.object({
  key: neo4jString,
  scope: z.enum(['caseType', 'global']),
  caseType: neo4jNullableString,
  memberCount: neo4jNumber,
  activityLogMemberCount: neo4jNumber,
  snapshotMemberCount: neo4jNumber,
  confidence: z.enum(['low', 'medium', 'high']),
  targetStage: neo4jString,
  targetSubStage: neo4jNullableString,
  medianDaysToStage: neo4jNullableNumber,
  daysToStageP25: neo4jNullableNumber,
  daysToStageP75: neo4jNullableNumber,
  timingFromActivityLog: neo4jBoolean,
  cohortMemberCaseIds: neo4jStringArray,
  sameTypeMemberCount: neo4jNumber,
});

const globalCohortRow = z.object({
  key: neo4jString,
  scope: z.enum(['caseType', 'global']),
  caseType: neo4jNullableString,
  memberCount: neo4jNumber,
  activityLogMemberCount: neo4jNumber,
  snapshotMemberCount: neo4jNumber,
  confidence: z.enum(['low', 'medium', 'high']),
  targetStage: neo4jString,
  targetSubStage: neo4jNullableString,
  medianDaysToStage: neo4jNullableNumber,
  daysToStageP25: neo4jNullableNumber,
  daysToStageP75: neo4jNullableNumber,
  timingFromActivityLog: neo4jBoolean,
  cohortMemberCaseIds: neo4jStringArray,
});

function describeSelection(
  scope: 'caseType' | 'global',
  caseType: string,
  targetStage: string,
  sameTypeMemberCount: number
): string {
  if (scope === 'caseType') return `same caseType cohort (${caseType})`;
  return thinSameTypeContextUsed(scope, sameTypeMemberCount)
    ? `widened to global ${targetStage} cohort; thin same-type context available (${sameTypeMemberCount} cases)`
    : `widened to global ${targetStage} cohort`;
}

export async function resolveSelectedCohort(
  caseId: string,
  targetStage: string,
  targetSubStage?: string | null
): Promise<{ targetCase: TargetCaseSummary; cohort: SelectedCohort }> {
  const targetCase = await resolveTargetCase(caseId);
  const rows = await runReadQuery(
    `MATCH (c:Case {caseId: $caseId})
     OPTIONAL MATCH (same:ReadinessCohort)
       WHERE same.scope = 'caseType'
         AND same.caseType = c.caseType
         AND same.targetStage = $targetStage
         AND coalesce(same.targetSubStage, '') = coalesce($targetSubStage, '')
     OPTIONAL MATCH (global:ReadinessCohort)
       WHERE global.scope = 'global'
         AND global.targetStage = $targetStage
         AND coalesce(global.targetSubStage, '') = coalesce($targetSubStage, '')
     WITH c, CASE WHEN same IS NOT NULL THEN same ELSE global END AS selected
     WHERE selected IS NOT NULL
     CALL {
       WITH c
       MATCH (peer:Case {caseType: c.caseType})-[:HAS_STAGE_EVENT]->(se:StageEvent)-[:FOR_STAGE]->(:Stage {name: $targetStage})
       WHERE coalesce(se.subStage, '') = coalesce($targetSubStage, '')
       RETURN count(DISTINCT peer) AS sameTypeMemberCount
     }
     OPTIONAL MATCH (selected)-[:HAS_MEMBER]->(member:Case)
     RETURN selected.key AS key,
            selected.scope AS scope,
            selected.caseType AS caseType,
            selected.memberCount AS memberCount,
            coalesce(selected.activityLogMemberCount, 0) AS activityLogMemberCount,
            coalesce(selected.snapshotMemberCount, selected.memberCount) AS snapshotMemberCount,
            selected.confidence AS confidence,
            selected.targetStage AS targetStage,
            selected.targetSubStage AS targetSubStage,
            selected.medianDaysToStage AS medianDaysToStage,
            selected.daysToStageP25 AS daysToStageP25,
            selected.daysToStageP75 AS daysToStageP75,
            coalesce(selected.timingFromActivityLog, false) AS timingFromActivityLog,
            collect(DISTINCT member.caseId)[0..12] AS cohortMemberCaseIds,
            sameTypeMemberCount`,
    { caseId: targetCase.caseId, targetStage, targetSubStage: targetSubStage ?? null },
    cohortRow
  );
  const row = rows[0];
  if (!row) {
    const reachCount = await countStageReaches(targetStage, targetSubStage ?? null);
    throw new NoReadinessCohortError(
      targetCase,
      targetStage,
      targetSubStage ?? null,
      reachCount.historicalPeerCount
    );
  }
  return {
    targetCase,
    cohort: {
      ...row,
      selectedCohortScope: row.scope,
      sameTypeThinContextUsed: thinSameTypeContextUsed(row.scope, row.sameTypeMemberCount),
      cohortSelectionCriteria: describeSelection(
        row.scope,
        targetCase.caseType,
        targetStage,
        row.sameTypeMemberCount
      ),
    },
  };
}

export async function resolveGlobalCohort(
  targetStage: string,
  targetSubStage?: string | null
): Promise<SelectedCohort> {
  const rows = await runReadQuery(
    `MATCH (rc:ReadinessCohort)
     WHERE rc.scope = 'global'
       AND rc.targetStage = $targetStage
       AND coalesce(rc.targetSubStage, '') = coalesce($targetSubStage, '')
     OPTIONAL MATCH (rc)-[:HAS_MEMBER]->(member:Case)
     RETURN rc.key AS key,
            rc.scope AS scope,
            rc.caseType AS caseType,
            rc.memberCount AS memberCount,
            coalesce(rc.activityLogMemberCount, 0) AS activityLogMemberCount,
            coalesce(rc.snapshotMemberCount, rc.memberCount) AS snapshotMemberCount,
            rc.confidence AS confidence,
            rc.targetStage AS targetStage,
            rc.targetSubStage AS targetSubStage,
            rc.medianDaysToStage AS medianDaysToStage,
            rc.daysToStageP25 AS daysToStageP25,
            rc.daysToStageP75 AS daysToStageP75,
            coalesce(rc.timingFromActivityLog, false) AS timingFromActivityLog,
            collect(DISTINCT member.caseId)[0..12] AS cohortMemberCaseIds`,
    { targetStage, targetSubStage: targetSubStage ?? null },
    globalCohortRow
  );
  const row = rows[0];
  if (!row) {
    const reachCount = await countStageReaches(targetStage, targetSubStage ?? null);
    throw new NoGlobalReadinessCohortError(
      targetStage,
      targetSubStage ?? null,
      reachCount.historicalPeerCount
    );
  }
  return {
    ...row,
    selectedCohortScope: row.scope,
    sameTypeMemberCount: 0,
    sameTypeThinContextUsed: false,
    cohortSelectionCriteria: `global ${targetStage} cohort (no seed case provided)`,
  };
}
