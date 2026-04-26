import type { Record as Neo4jRecord } from 'neo4j-driver';

export interface SignalDef {
  key: string;
  label: string;
  kind: string;
}

export interface SignalObservation extends SignalDef {
  caseId: string;
  observedAt: string | null;
  sourceKind: string;
  emitLabel?: 'Document' | 'Communication' | 'ActivityEvent';
  emitSourceId?: string;
}

export interface CaseSignalWriteRow {
  caseId: string;
  signalKey: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  count: number;
  sourceKinds: string[];
}

export interface SignalEmitWriteRow {
  sourceId: string;
  signalKey: string;
}

export interface SignalWriteSet {
  signalDefs: SignalDef[];
  caseSignalRows: CaseSignalWriteRow[];
  documentEmitRows: SignalEmitWriteRow[];
  communicationEmitRows: SignalEmitWriteRow[];
  activityEmitRows: SignalEmitWriteRow[];
}

export interface CypherWriteRunner {
  run(query: string, params?: object): PromiseLike<unknown> | unknown;
}

export interface CypherReadRunner {
  run(query: string, params?: object): PromiseLike<{ records: Neo4jRecord[] }>;
}
