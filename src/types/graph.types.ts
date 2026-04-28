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
  // SLA fields from financial projection (per-stage SLA evaluation)
  slaStatus: string | null;
  slaForCurrentStage: string | null;
  slaDetails: string | null;
  daysInCurrentStage: number | null;
  expectedCompletionDate: string | null;
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
  source: string | null;
  userName: string | null;
  dueDate: string | null;
  targetDate: string | null;
  assigneeName: string | null;
  documentType: string | null;
  documentCategory: string | null;
  fileName: string | null;
  status: string | null;
}

export interface ConversationNode {
  sourceId: string;
  caseId: string;
  sessionId: string | null;
  userName: string | null;
  caseType: string | null;
  caseStatus: string | null;
  status: string | null;
  messageCount: number;
  lastAgentUsed: string | null;
  routingReason: string | null;
  workAccidentFlag: boolean | null;
  createdAt: string | null;
  lastActivity: string | null;
  triageCompletedAt: string | null;
  submittedForReviewAt: string | null;
  lastSummarizedAt: string | null;
  accidentDate: string | null;
  accidentType: string | null;
  medicalTreatment: string | null;
  currentStatus: string | null;
  thresholdChecks: string[]; // ["statuteOfLimitations:PASS", ...]
  thresholdAllPass: boolean | null;
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
