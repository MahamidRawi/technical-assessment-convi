import type { ConfidenceBand } from '@/constants/readiness';

export type EvidenceSourceType =
  | 'Document'
  | 'Communication'
  | 'Case'
  | 'Contact'
  | 'ActivityEvent'
  | 'StageEvent'
  | 'ReadinessSignal';

export interface EvidenceItem {
  sourceType: EvidenceSourceType;
  sourceId: string;
  label: string;
  viaTool: string;
}

export interface StepTrace {
  step: number;
  toolName: string;
  toolInput: unknown;
  summary: string;
  evidenceIds: EvidenceItem[];
  durationMs: number;
  cypher?: string;
  params?: Record<string, unknown>;
  rowCount?: number;
}

export interface ObservedSignalTrace {
  signalKey: string;
  label: string;
  kind: string;
  support: number;
  lift: number;
  weight: number;
  medianLeadDays: number | null;
}

export interface MatchedSignalTrace {
  signalKey: string;
  label: string;
  kind: string;
  weight: number;
  observedAt: string | null;
  evidence: EvidenceItem[];
}

export interface MissingSignalTrace {
  signalKey: string;
  label: string;
  kind: string;
  weight: number;
  medianLeadDays: number | null;
}

export interface TimelineEstimateTrace {
  timingStatus: 'no_estimate' | 'future_estimate' | 'behind_historical_trajectory';
  remainingDaysMedian: number | null;
  remainingDaysP25: number | null;
  remainingDaysP75: number | null;
  behindByDaysMedian: number | null;
  behindByDaysP25: number | null;
  behindByDaysP75: number | null;
  comparableCaseIds: string[];
  timingSources: Array<{ caseId: string; timingSource: string }>;
}

export interface OptionalPolicyBaselineTrace {
  source: 'optionalPolicyBaseline';
  ready: boolean;
  missingSignals: string[];
}

export interface ReadinessDecisionArtifact {
  question: string;
  targetCase: {
    caseId: string;
    caseName: string;
    caseType: string;
    currentStage: string;
    currentSubStage: string | null;
  };
  targetStage: string;
  targetSubStage: string | null;
  toolsUsed: string[];
  availability: 'cohort' | 'sparse_stage' | 'none';
  cohortAvailable: boolean;
  historicalPeerCount: number;
  estimationBasis: 'cohort_similar_cases' | 'stage_timing_fallback' | 'none';
  cohortSelectionCriteria: string;
  cohortSize: number;
  cohortMemberCaseIds: string[];
  observedCommonSignals: ObservedSignalTrace[];
  matchedSignals: MatchedSignalTrace[];
  missingSignals: MissingSignalTrace[];
  contextDifferences: MissingSignalTrace[];
  timelineEstimate: TimelineEstimateTrace;
  confidence: ConfidenceBand;
  uncertaintyReasons: string[];
  optionalPolicyBaselineComparison?: OptionalPolicyBaselineTrace | null;
}
