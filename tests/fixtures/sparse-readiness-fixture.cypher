CREATE (:Stage {name: 'case_building'});
CREATE (:Stage {name: 'file_claim'});

MATCH (buildStage:Stage {name: 'case_building'})
CREATE (:Case {
  sourceId: 'sparse-target-source',
  caseId: 'SPARSE-TARGET',
  caseName: 'Sparse Target',
  caseNumber: '9001',
  caseType: 'liability',
  legalStage: 'case_building',
  subStage: null,
  phase: 'active',
  status: 'open',
  isSigned: true,
  createdAt: datetime('2025-01-02T00:00:00Z'),
  eventDate: datetime('2025-01-01T00:00:00Z'),
  signedAt: datetime('2025-01-03T00:00:00Z'),
  legalStageEnteredAt: datetime('2025-01-02T00:00:00Z'),
  updatedAt: datetime('2025-01-05T00:00:00Z'),
  completionRate: 0.2,
  missingCritical: [],
  monthsSinceEvent: 12,
  isOverdue: false,
  mainInjury: null,
  aiGeneratedSummary: 'Sparse target case'
})-[:IN_STAGE]->(buildStage);

MATCH (fileStage:Stage {name: 'file_claim'})
CREATE (peer:Case {
  sourceId: 'sparse-peer-source',
  caseId: 'SPARSE-PEER',
  caseName: 'Sparse Peer',
  caseNumber: '9002',
  caseType: 'liability',
  legalStage: 'file_claim',
  subStage: null,
  phase: 'active',
  status: 'open',
  isSigned: true,
  createdAt: datetime('2025-01-02T00:00:00Z'),
  eventDate: datetime('2025-01-01T00:00:00Z'),
  signedAt: datetime('2025-01-03T00:00:00Z'),
  legalStageEnteredAt: datetime('2025-04-11T00:00:00Z'),
  updatedAt: datetime('2025-04-11T00:00:00Z'),
  completionRate: 0.6,
  missingCritical: [],
  monthsSinceEvent: 12,
  isOverdue: false,
  mainInjury: null,
  aiGeneratedSummary: 'Sparse peer case'
})
CREATE (stageEvent:StageEvent {
  key: 'sparse-peer-file-claim',
  caseId: 'SPARSE-PEER',
  stageName: 'file_claim',
  subStage: null,
  occurredAt: datetime('2025-04-11T00:00:00Z'),
  source: 'activity_log'
})
MERGE (peer)-[:IN_STAGE]->(fileStage)
MERGE (peer)-[:HAS_STAGE_EVENT]->(stageEvent)
MERGE (stageEvent)-[:FOR_STAGE]->(fileStage)
MERGE (peer)-[:REACHED_STAGE {stage: 'file_claim', at: datetime('2025-04-11T00:00:00Z'), source: 'activity_log'}]->(fileStage);
