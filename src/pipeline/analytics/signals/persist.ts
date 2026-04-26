import type { SignalWriteSet, CypherWriteRunner } from './types';

export async function persistSignalWriteSet(
  tx: CypherWriteRunner,
  writeSet: SignalWriteSet
): Promise<void> {
  await tx.run('MATCH ()-[r:HAS_SIGNAL|EMITS_SIGNAL]->() DELETE r');
  await tx.run('MATCH (rs:ReadinessSignal) DETACH DELETE rs');
  await tx.run(
    `UNWIND $rows AS row
     MERGE (rs:ReadinessSignal {key: row.key})
     SET rs.label = row.label, rs.kind = row.kind`,
    { rows: writeSet.signalDefs }
  );
  await tx.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (rs:ReadinessSignal {key: row.signalKey})
     MERGE (c)-[rel:HAS_SIGNAL]->(rs)
     SET rel.firstObservedAt = CASE WHEN row.firstObservedAt IS NULL THEN null ELSE datetime(row.firstObservedAt) END,
         rel.lastObservedAt = CASE WHEN row.lastObservedAt IS NULL THEN null ELSE datetime(row.lastObservedAt) END,
         rel.count = row.count,
         rel.sourceKinds = row.sourceKinds`,
    { rows: writeSet.caseSignalRows }
  );
  await tx.run(
    `UNWIND $rows AS row
     MATCH (d:Document {sourceId: row.sourceId}), (rs:ReadinessSignal {key: row.signalKey})
     MERGE (d)-[:EMITS_SIGNAL]->(rs)`,
    { rows: writeSet.documentEmitRows }
  );
  await tx.run(
    `UNWIND $rows AS row
     MATCH (com:Communication {sourceId: row.sourceId}), (rs:ReadinessSignal {key: row.signalKey})
     MERGE (com)-[:EMITS_SIGNAL]->(rs)`,
    { rows: writeSet.communicationEmitRows }
  );
  await tx.run(
    `UNWIND $rows AS row
     MATCH (ae:ActivityEvent {sourceId: row.sourceId}), (rs:ReadinessSignal {key: row.signalKey})
     MERGE (ae)-[:EMITS_SIGNAL]->(rs)`,
    { rows: writeSet.activityEmitRows }
  );
}
