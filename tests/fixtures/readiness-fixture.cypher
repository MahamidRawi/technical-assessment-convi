CREATE (:Stage {name: 'case_building'});
CREATE (:Stage {name: 'file_claim'});
CREATE (:DocumentCategory {name: 'medical'});
CREATE (:DocumentCategory {name: 'evidence'});
CREATE (:DocumentType {name: 'medical_report'});
CREATE (:DocumentType {name: 'police_report'});
CREATE (:Injury {normalized: 'whiplash', name: 'Whiplash'});
CREATE (:BodyPart {normalized: 'neck', name: 'Neck'});
CREATE (:InsuranceCompany {normalized: 'harel', name: 'Harel'});
CREATE (:Contact {dedupKey: 'insurer:harel', name: 'Harel Adjuster', normalizedName: 'harel adjuster', contactType: 'insurance_company', phone: null, email: 'claims@harel.test', sourceIds: ['insurer:harel']});

CREATE (target:Case {
  sourceId: 'case-target',
  caseId: 'CASE-TARGET',
  caseName: 'Dana Levin',
  caseNumber: '20260001',
  caseType: 'car_accident_minor',
  legalStage: 'case_building',
  subStage: 'documents_pending',
  phase: 'active',
  status: 'open',
  isSigned: true,
  createdAt: datetime('2026-03-02T00:00:00Z'),
  eventDate: datetime('2026-03-01T00:00:00Z'),
  updatedAt: datetime('2026-04-01T00:00:00Z'),
  completionRate: 0.52,
  missingCritical: ['evidence'],
  monthsSinceEvent: 2,
  isOverdue: false,
  mainInjury: 'Whiplash',
  aiGeneratedSummary: null
});

CREATE (targetClient:Contact {
  dedupKey: 'client:target',
  name: 'Dana Levin',
  normalizedName: 'dana levin',
  contactType: 'client',
  phone: '0501111111',
  email: 'dana@example.test',
  sourceIds: ['client:target']
});
MATCH (target:Case {caseId: 'CASE-TARGET'}), (targetClient:Contact {dedupKey: 'client:target'}), (ins:InsuranceCompany {normalized: 'harel'}), (inj:Injury {normalized: 'whiplash'}), (bp:BodyPart {normalized: 'neck'}), (stage:Stage {name: 'case_building'})
MERGE (target)-[:HAS_CLIENT]->(targetClient)
MERGE (target)-[:HAS_CONTACT {role: 'client'}]->(targetClient)
MERGE (target)-[:AGAINST_INSURER]->(ins)
MERGE (target)-[:HAS_INJURY {status: 'current'}]->(inj)
MERGE (target)-[:AFFECTS_BODY_PART]->(bp)
MERGE (target)-[:IN_STAGE]->(stage);

CREATE (targetDoc:Document {
  sourceId: 'doc:target:medical',
  caseId: 'CASE-TARGET',
  fileName: 'Dana medical report',
  mimeType: 'application/pdf',
  documentType: 'medical_report',
  documentCategory: 'medical',
  documentDate: datetime('2026-03-10T00:00:00Z'),
  uploadedAt: datetime('2026-03-10T00:00:00Z'),
  processingStatus: 'completed',
  hasOcr: true,
  pageCount: 4,
  sourceFileId: null,
  isModified: false
});
MATCH (target:Case {caseId: 'CASE-TARGET'}), (targetDoc:Document {sourceId: 'doc:target:medical'}), (dc:DocumentCategory {name: 'medical'}), (dt:DocumentType {name: 'medical_report'})
MERGE (target)-[:HAS_DOCUMENT]->(targetDoc)
MERGE (targetDoc)-[:OF_CATEGORY]->(dc)
MERGE (targetDoc)-[:OF_TYPE]->(dt);

CREATE (targetCom:Communication {
  sourceId: 'com:target:1',
  caseId: 'CASE-TARGET',
  type: 'email',
  direction: 'inbound',
  status: 'received',
  sentAt: datetime('2026-03-18T00:00:00Z'),
  subject: 'Need more evidence',
  textPreview: 'Please send police report.',
  fromName: 'Harel Adjuster',
  transcript: null,
  language: 'he'
});
MATCH (target:Case {caseId: 'CASE-TARGET'}), (targetCom:Communication {sourceId: 'com:target:1'}), (insurerContact:Contact {dedupKey: 'insurer:harel'}), (targetClient:Contact {dedupKey: 'client:target'})
MERGE (target)-[:HAS_COMMUNICATION]->(targetCom)
MERGE (targetCom)-[:FROM_CONTACT]->(insurerContact)
MERGE (targetCom)-[:TO_CONTACT]->(targetClient);

CREATE (targetAct:ActivityEvent {
  sourceId: 'act:target:1',
  caseId: 'CASE-TARGET',
  category: 'document',
  action: 'file_uploaded',
  summary: 'Medical report uploaded',
  at: datetime('2026-03-10T00:00:00Z')
});
MATCH (target:Case {caseId: 'CASE-TARGET'}), (targetAct:ActivityEvent {sourceId: 'act:target:1'})
MERGE (target)-[:HAS_ACTIVITY]->(targetAct);

CREATE (control:Case {
  sourceId: 'case-control',
  caseId: 'CASE-CONTROL',
  caseName: 'Sparse Control',
  caseNumber: '20269999',
  caseType: 'car_accident_minor',
  legalStage: 'case_building',
  subStage: null,
  phase: 'active',
  status: 'open',
  isSigned: true,
  createdAt: datetime('2026-02-02T00:00:00Z'),
  eventDate: datetime('2026-02-01T00:00:00Z'),
  updatedAt: datetime('2026-04-01T00:00:00Z'),
  completionRate: 0.2,
  missingCritical: ['medical', 'evidence'],
  monthsSinceEvent: 3,
  isOverdue: false,
  mainInjury: 'Whiplash',
  aiGeneratedSummary: null
});
MATCH (control:Case {caseId: 'CASE-CONTROL'}), (ins:InsuranceCompany {normalized: 'harel'}), (inj:Injury {normalized: 'whiplash'}), (bp:BodyPart {normalized: 'neck'}), (stage:Stage {name: 'case_building'})
MERGE (control)-[:AGAINST_INSURER]->(ins)
MERGE (control)-[:HAS_INJURY {status: 'current'}]->(inj)
MERGE (control)-[:AFFECTS_BODY_PART]->(bp)
MERGE (control)-[:IN_STAGE]->(stage);

CREATE (nodate:Case {
  sourceId: 'case-nodate',
  caseId: 'CASE-NODATE',
  caseName: 'No Date Case',
  caseNumber: '20268888',
  caseType: 'car_accident_minor',
  legalStage: 'case_building',
  subStage: null,
  phase: 'active',
  status: 'open',
  isSigned: true,
  createdAt: datetime('2026-02-02T00:00:00Z'),
  eventDate: null,
  updatedAt: datetime('2026-04-01T00:00:00Z'),
  completionRate: 0.3,
  missingCritical: ['medical', 'evidence'],
  monthsSinceEvent: null,
  isOverdue: false,
  mainInjury: 'Whiplash',
  aiGeneratedSummary: null
});
MATCH (nodate:Case {caseId: 'CASE-NODATE'}), (ins:InsuranceCompany {normalized: 'harel'}), (inj:Injury {normalized: 'whiplash'}), (bp:BodyPart {normalized: 'neck'}), (stage:Stage {name: 'case_building'})
MERGE (nodate)-[:AGAINST_INSURER]->(ins)
MERGE (nodate)-[:HAS_INJURY {status: 'current'}]->(inj)
MERGE (nodate)-[:AFFECTS_BODY_PART]->(bp)
MERGE (nodate)-[:IN_STAGE]->(stage);

UNWIND range(1, 12) AS i
CREATE (peer:Case {
  sourceId: 'case:peer:' + toString(i),
  caseId: 'CASE-PEER-' + toString(i),
  caseName: 'Peer Case ' + toString(i),
  caseNumber: '20261' + toString(100 + i),
  caseType: 'car_accident_minor',
  legalStage: 'file_claim',
  subStage: null,
  phase: 'active',
  status: 'open',
  isSigned: true,
  createdAt: datetime('2026-01-01T00:00:00Z') + duration({days: i}),
  eventDate: datetime('2026-01-01T00:00:00Z') + duration({days: i}),
  updatedAt: datetime('2026-04-15T00:00:00Z'),
  completionRate: 0.92,
  missingCritical: [],
  monthsSinceEvent: 3,
  isOverdue: false,
  mainInjury: 'Whiplash',
  aiGeneratedSummary: null
})
CREATE (peerClient:Contact {
  dedupKey: 'client:peer:' + toString(i),
  name: 'Peer Client ' + toString(i),
  normalizedName: 'peer client ' + toString(i),
  contactType: 'client',
  phone: null,
  email: 'peer' + toString(i) + '@example.test',
  sourceIds: ['client:peer:' + toString(i)]
})
CREATE (med:Document {
  sourceId: 'doc:peer:medical:' + toString(i),
  caseId: 'CASE-PEER-' + toString(i),
  fileName: 'Peer medical ' + toString(i),
  mimeType: 'application/pdf',
  documentType: 'medical_report',
  documentCategory: 'medical',
  documentDate: datetime('2026-01-20T00:00:00Z') + duration({days: i}),
  uploadedAt: datetime('2026-01-20T00:00:00Z') + duration({days: i}),
  processingStatus: 'completed',
  hasOcr: true,
  pageCount: 4,
  sourceFileId: null,
  isModified: false
})
CREATE (ev:Document {
  sourceId: 'doc:peer:evidence:' + toString(i),
  caseId: 'CASE-PEER-' + toString(i),
  fileName: 'Peer police report ' + toString(i),
  mimeType: 'application/pdf',
  documentType: 'police_report',
  documentCategory: 'evidence',
  documentDate: datetime('2026-01-25T00:00:00Z') + duration({days: i}),
  uploadedAt: datetime('2026-01-25T00:00:00Z') + duration({days: i}),
  processingStatus: 'completed',
  hasOcr: true,
  pageCount: 2,
  sourceFileId: null,
  isModified: false
})
CREATE (com:Communication {
  sourceId: 'com:peer:' + toString(i),
  caseId: 'CASE-PEER-' + toString(i),
  type: 'email',
  direction: 'inbound',
  status: 'received',
  sentAt: datetime('2026-01-28T00:00:00Z') + duration({days: i}),
  subject: 'Peer correspondence ' + toString(i),
  textPreview: 'Insurance follow-up',
  fromName: 'Harel Adjuster',
  transcript: null,
  language: 'he'
})
CREATE (act:ActivityEvent {
  sourceId: 'act:peer:' + toString(i),
  caseId: 'CASE-PEER-' + toString(i),
  category: 'document',
  action: 'file_uploaded',
  summary: 'Evidence package complete',
  at: datetime('2026-01-25T00:00:00Z') + duration({days: i})
})
CREATE (stageEvent:StageEvent {
  key: 'stage:peer:' + toString(i),
  caseId: 'CASE-PEER-' + toString(i),
  stageName: 'file_claim',
  subStage: null,
  occurredAt: datetime('2026-04-05T00:00:00Z') + duration({days: i}),
  source: 'activity_log'
})
WITH peer, peerClient, med, ev, com, act, stageEvent, i
MATCH (buildStage:Stage {name: 'case_building'}), (fileStage:Stage {name: 'file_claim'}), (medicalCat:DocumentCategory {name: 'medical'}), (evidenceCat:DocumentCategory {name: 'evidence'}), (medicalType:DocumentType {name: 'medical_report'}), (policeType:DocumentType {name: 'police_report'}), (inj:Injury {normalized: 'whiplash'}), (bp:BodyPart {normalized: 'neck'}), (ins:InsuranceCompany {normalized: 'harel'}), (insurerContact:Contact {dedupKey: 'insurer:harel'})
MERGE (peer)-[:HAS_CLIENT]->(peerClient)
MERGE (peer)-[:HAS_CONTACT {role: 'client'}]->(peerClient)
MERGE (peer)-[:AGAINST_INSURER]->(ins)
MERGE (peer)-[:HAS_INJURY {status: 'current'}]->(inj)
MERGE (peer)-[:AFFECTS_BODY_PART]->(bp)
MERGE (peer)-[:IN_STAGE]->(fileStage)
MERGE (peer)-[:REACHED_STAGE {stage: 'case_building', at: datetime('2026-01-10T00:00:00Z') + duration({days: i}), source: 'activity_log'}]->(buildStage)
MERGE (peer)-[:HAS_DOCUMENT]->(med)
MERGE (med)-[:OF_CATEGORY]->(medicalCat)
MERGE (med)-[:OF_TYPE]->(medicalType)
MERGE (peer)-[:HAS_DOCUMENT]->(ev)
MERGE (ev)-[:OF_CATEGORY]->(evidenceCat)
MERGE (ev)-[:OF_TYPE]->(policeType)
MERGE (peer)-[:HAS_COMMUNICATION]->(com)
MERGE (com)-[:FROM_CONTACT]->(insurerContact)
MERGE (com)-[:TO_CONTACT]->(peerClient)
MERGE (peer)-[:HAS_ACTIVITY]->(act)
MERGE (peer)-[:HAS_STAGE_EVENT]->(stageEvent)
MERGE (stageEvent)-[:FOR_STAGE]->(fileStage)
MERGE (peer)-[:REACHED_STAGE {stage: 'file_claim', at: datetime('2026-04-05T00:00:00Z') + duration({days: i}), source: 'activity_log'}]->(fileStage);
