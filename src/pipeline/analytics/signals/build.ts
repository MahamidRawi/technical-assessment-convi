import type {
  CaseSignalWriteRow,
  SignalDef,
  SignalEmitWriteRow,
  SignalObservation,
  SignalWriteSet,
} from './types';

interface CaseSignalAccumulator {
  caseId: string;
  signalKey: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  count: number;
  sourceKinds: Set<string>;
}

function chooseEarlier(current: string | null, next: string | null): string | null {
  if (!current) return next;
  if (!next) return current;
  return current <= next ? current : next;
}

function chooseLater(current: string | null, next: string | null): string | null {
  if (!current) return next;
  if (!next) return current;
  return current >= next ? current : next;
}

function emitRows(
  observations: SignalObservation[],
  emitLabel: SignalObservation['emitLabel']
): SignalEmitWriteRow[] {
  return observations
    .filter((obs) => obs.emitLabel === emitLabel && Boolean(obs.emitSourceId))
    .map((obs) => ({ sourceId: String(obs.emitSourceId), signalKey: obs.key }));
}

function caseSignalRows(observations: SignalObservation[]): CaseSignalWriteRow[] {
  const rows = new Map<string, CaseSignalAccumulator>();
  for (const obs of observations) {
    const key = `${obs.caseId}|${obs.key}`;
    const existing = rows.get(key) ?? {
      caseId: obs.caseId,
      signalKey: obs.key,
      firstObservedAt: null,
      lastObservedAt: null,
      count: 0,
      sourceKinds: new Set<string>(),
    };
    existing.firstObservedAt = chooseEarlier(existing.firstObservedAt, obs.observedAt);
    existing.lastObservedAt = chooseLater(existing.lastObservedAt, obs.observedAt);
    existing.count += 1;
    existing.sourceKinds.add(obs.sourceKind);
    rows.set(key, existing);
  }
  return Array.from(rows.values()).map((row) => ({
    caseId: row.caseId,
    signalKey: row.signalKey,
    firstObservedAt: row.firstObservedAt,
    lastObservedAt: row.lastObservedAt,
    count: row.count,
    sourceKinds: Array.from(row.sourceKinds.values()),
  }));
}

export function buildSignalWriteSet(observations: SignalObservation[]): SignalWriteSet {
  const signalDefs = new Map<string, SignalDef>();
  for (const obs of observations) {
    signalDefs.set(obs.key, { key: obs.key, label: obs.label, kind: obs.kind });
  }
  return {
    signalDefs: Array.from(signalDefs.values()),
    caseSignalRows: caseSignalRows(observations),
    documentEmitRows: emitRows(observations, 'Document'),
    communicationEmitRows: emitRows(observations, 'Communication'),
    activityEmitRows: emitRows(observations, 'ActivityEvent'),
  };
}
