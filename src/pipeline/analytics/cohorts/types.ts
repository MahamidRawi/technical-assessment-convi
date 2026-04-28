import type { Record as Neo4jRecord } from 'neo4j-driver';

export interface CaseInfo {
  caseId: string;
  caseType: string;
  eventDate: string | null;
}

export interface StageReach {
  caseId: string;
  caseType: string;
  stageName: string;
  subStage: string | null;
  occurredAt: string;
  source: string;
}

export interface CaseSignal {
  signalKey: string;
  firstObservedAt: string | null;
}

export interface CohortInputs {
  cases: Map<string, CaseInfo>;
  reaches: StageReach[];
  signalsByCase: Map<string, CaseSignal[]>;
}

import type { ConfidenceBand } from '@/constants/readiness';

export interface CohortWriteRow {
  key: string;
  targetStage: string;
  targetSubStage: string | null;
  caseType: string | null;
  scope: 'caseType' | 'global';
  memberCount: number;
  activityLogMemberCount: number;
  snapshotMemberCount: number;
  confidence: ConfidenceBand;
  medianDaysToStage: number | null;
  daysToStageP25: number | null;
  daysToStageP75: number | null;
  timingFromActivityLog: boolean;
}

export interface CohortMemberWriteRow {
  key: string;
  caseId: string;
}

export interface CommonSignalWriteRow {
  key: string;
  signalKey: string;
  support: number;
  lift: number;
  weight: number;
  medianLeadDays: number | null;
}

export interface CohortWriteSet {
  cohortRows: CohortWriteRow[];
  memberRows: CohortMemberWriteRow[];
  signalRows: CommonSignalWriteRow[];
  /** Sub-threshold signals surfaced as supplementary evidence on small cohorts. */
  weakSignalRows: CommonSignalWriteRow[];
}

export interface CohortWriteRunner {
  run(query: string, params?: object): PromiseLike<unknown> | unknown;
}

export interface CohortReadRunner {
  run(query: string, params?: object): PromiseLike<{ records: Neo4jRecord[] }>;
}
