import type { AgentStatusEvent } from './stream.types';
import type { ReadinessDecisionArtifact, StepTrace } from './trace.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isAgentStatusEvent(value: unknown): value is AgentStatusEvent {
  return (
    isRecord(value) &&
    value.agent === 'reasoner' &&
    typeof value.state === 'string' &&
    typeof value.message === 'string'
  );
}

export function isStepTrace(value: unknown): value is StepTrace {
  return (
    isRecord(value) &&
    typeof value.step === 'number' &&
    typeof value.toolName === 'string' &&
    typeof value.summary === 'string' &&
    Array.isArray(value.evidenceIds) &&
    typeof value.durationMs === 'number'
  );
}

export function isReadinessDecisionArtifact(value: unknown): value is ReadinessDecisionArtifact {
  return (
    isRecord(value) &&
    typeof value.question === 'string' &&
    isRecord(value.targetCase) &&
    typeof value.targetStage === 'string' &&
    Array.isArray(value.toolsUsed) &&
    Array.isArray(value.observedCommonSignals)
  );
}
