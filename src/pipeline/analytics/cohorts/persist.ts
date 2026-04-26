import type { CohortWriteRunner, CohortWriteSet } from './types';

export async function persistCohortWriteSet(
  tx: CohortWriteRunner,
  writeSet: CohortWriteSet
): Promise<void> {
  await tx.run('MATCH (rc:ReadinessCohort) DETACH DELETE rc');
  await tx.run(
    `UNWIND $rows AS row
     MERGE (rc:ReadinessCohort {key: row.key})
     SET rc.targetStage = row.targetStage,
         rc.targetSubStage = row.targetSubStage,
         rc.caseType = row.caseType,
         rc.scope = row.scope,
         rc.memberCount = row.memberCount,
         rc.activityLogMemberCount = row.activityLogMemberCount,
         rc.snapshotMemberCount = row.snapshotMemberCount,
         rc.confidence = row.confidence,
         rc.medianDaysToStage = row.medianDaysToStage,
         rc.daysToStageP25 = row.daysToStageP25,
         rc.daysToStageP75 = row.daysToStageP75,
         rc.timingFromActivityLog = row.timingFromActivityLog`,
    { rows: writeSet.cohortRows }
  );
  await tx.run(
    `UNWIND $rows AS row
     MATCH (rc:ReadinessCohort {key: row.key}), (s:Stage {name: row.targetStage})
     MERGE (rc)-[:TARGET_STAGE]->(s)`,
    { rows: writeSet.cohortRows.map((row) => ({ key: row.key, targetStage: row.targetStage })) }
  );
  await tx.run(
    `UNWIND $rows AS row
     MATCH (rc:ReadinessCohort {key: row.key}), (c:Case {caseId: row.caseId})
     MERGE (rc)-[:HAS_MEMBER]->(c)`,
    { rows: writeSet.memberRows }
  );
  await tx.run(
    `UNWIND $rows AS row
     MATCH (rc:ReadinessCohort {key: row.key}), (rs:ReadinessSignal {key: row.signalKey})
     MERGE (rc)-[rel:COMMON_SIGNAL]->(rs)
     SET rel.support = row.support,
         rel.lift = row.lift,
         rel.weight = row.weight,
         rel.medianLeadDays = row.medianLeadDays`,
    { rows: writeSet.signalRows }
  );
}
