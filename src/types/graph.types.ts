export interface CaseNode {
  sourceId: string;
  caseId: string;
  caseName: string;
  caseNumber: string | null;
  caseType: string;
  legalStage: string;
  subStage: string | null;
  phase: string;
  status: string;
  isSigned: boolean;
  clientContactId: string | null;
  createdAt: string | null;
  eventDate: string | null;
  signedAt: string | null;
  legalStageEnteredAt: string | null;
  updatedAt: string | null;
  completionRate: number;
  missingCritical: string[];
  monthsSinceEvent: number | null;
  isOverdue: boolean | null;
  mainInjury: string | null;
  aiGeneratedSummary: string | null;
  clientAge: number | null;
  clientBirthDate: string | null;
  clientGender: string | null;
  workAccidentFlag: boolean | null;
  triageSummary: string | null;
}

export interface ContactNode {
  sourceId: string;
  name: string;
  normalizedName: string;
  contactType: string;
  phone: string | null;
  email: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
}

export interface DocumentNode {
  sourceId: string;
  caseId: string;
  fileName: string;
  mimeType: string;
  documentType: string;
  documentCategory: string;
  documentDate: string | null;
  uploadedAt: string;
  processingStatus: string;
  hasOcr: boolean;
  pageCount: number | null;
  sourceFileId: string | null;
  isModified: boolean;
}

export interface CommunicationNode {
  sourceId: string;
  caseId: string;
  type: string;
  direction: string;
  status: string;
  sentAt: string | null;
  subject: string;
  textPreview: string;
  fromName: string;
  language: string;
}

export interface StageNode {
  name: string;
}

export interface DocumentCategoryNode {
  name: string;
}

export interface DocumentTypeNode {
  name: string;
}

export interface InjuryNode {
  normalized: string;
  name: string;
}

export interface BodyPartNode {
  normalized: string;
  name: string;
}

export interface InsuranceCompanyNode {
  normalized: string;
  name: string;
}

export interface ExpertNode {
  key: string;
  normalized: string;
  name: string;
  specialty: string | null;
}

export interface ReachedStageEdge {
  caseId: string;
  stageName: string;
  at: string;
}

export interface ActivityEventNode {
  sourceId: string;
  caseId: string;
  category: string | null;
  action: string;
  summary: string | null;
  at: string | null;
}

export interface StageEventNode {
  key: string;
  caseId: string;
  stageName: string;
  subStage: string | null;
  occurredAt: string;
  source: 'activity_log' | 'current_stage_snapshot' | string;
}

export interface ReadinessSignalNode {
  key: string;
  label: string;
  kind: string;
}

export interface ReadinessCohortNode {
  key: string;
  targetStage: string;
  targetSubStage: string | null;
  caseType: string | null;
  scope: 'caseType' | 'global';
  memberCount: number;
  activityLogMemberCount: number;
  snapshotMemberCount: number;
  medianDaysToStage: number | null;
  daysToStageP25: number | null;
  daysToStageP75: number | null;
  timingFromActivityLog: boolean;
}

export interface CommonSignalEdge {
  support: number;
  lift: number;
  medianLeadDays: number | null;
  weight: number;
}

export interface CaseSignalEdge {
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  count: number;
  sourceKinds: string[];
}

export interface DocumentChunkNode {
  chunkId: string;
  documentId: string;
  caseId: string;
  chunkNumber: number;
  pageRange: string | null;
  text: string;
  textPreview: string;
  summary: string | null;
  gcsUri: string | null;
  charCount: number;
  source: string;
  chunkHash?: string;
}

export interface EvidenceFactNode {
  factId: string;
  caseId: string;
  documentId: string;
  chunkId: string;
  kind: string;
  subtype: string | null;
  label: string;
  value: string | null;
  numericValue: number | null;
  unit: string | null;
  fromDate: string | null;
  toDate: string | null;
  observedDate: string | null;
  confidence: number;
  quote: string;
  metadata: string | null;
  source?: 'regex' | 'llm';
  extractorVersion?: string;
  chunkHash?: string;
}

export interface CaseValuationNode {
  valuationId: string;
  caseId: string;
  compensationMin: number | null;
  compensationMax: number | null;
  feeMin: number | null;
  feeMax: number | null;
  totalEstimate: number | null;
  basis: string | null;
  status: string | null;
  analysisDate: string | null;
}

export interface DamageComponentNode {
  componentId: string;
  valuationId: string;
  caseId: string;
  kind: string;
  amount: number;
}
