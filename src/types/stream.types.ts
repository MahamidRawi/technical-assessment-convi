import type { UIMessage } from 'ai';
import type { ReadinessDecisionArtifact, StepTrace } from './trace.types';

export type AgentName = 'reasoner';

export type AgentStatusState = 'working' | 'done' | 'error' | 'tool';

export interface AgentStatusEvent {
  agent: AgentName;
  state: AgentStatusState;
  message: string;
  toolName?: string;
}

export type OnAgentStatus = (event: AgentStatusEvent) => void;
export type OnStepTrace = (trace: StepTrace) => void;
export type OnReadinessDecision = (artifact: ReadinessDecisionArtifact) => void;

export type StreamDataParts = {
  agentStatus: AgentStatusEvent;
  subToolCall: AgentStatusEvent;
  stepTrace: StepTrace;
  readinessDecisionArtifact: ReadinessDecisionArtifact;
};

export type StreamUIMessage = UIMessage<unknown, StreamDataParts>;
