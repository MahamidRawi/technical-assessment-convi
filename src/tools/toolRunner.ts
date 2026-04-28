import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { z } from 'zod';
import type { OnAgentStatus, OnReadinessDecision, OnStepTrace } from '@/types/stream.types';
import type { StepTrace } from '@/types/trace.types';
import type { TurnLogger } from '@/utils/turnLogger';
import type { ToolPlan } from '@/agents/intentPlanner';
import type { EvidenceLedger } from '@/agents/evidenceLedger';
import { observeToolResult } from '@/agents/evidenceLedger';
import type { ToolDefinition } from './types';
import { toToolErrorResult } from './toolErrors';
import type { ReadinessArtifactComposer } from './readiness/artifactComposer';
import { validateToolCallAgainstPlan } from './toolCallPolicy';

const tracer = trace.getTracer('caseReasoner', '1.0.0');

export interface ToolRunnerCallbacks {
  onAgentStatus?: OnAgentStatus;
  onStepTrace?: OnStepTrace;
  onReadinessDecision?: OnReadinessDecision;
  turnLogger?: TurnLogger;
  readinessComposer?: ReadinessArtifactComposer;
  toolPlan?: ToolPlan;
  evidenceLedger?: EvidenceLedger;
  nextStep(): number;
}

export function createToolExecute<TSchema extends z.ZodTypeAny, TResult>(
  def: ToolDefinition<TSchema, TResult>,
  callbacks: ToolRunnerCallbacks
): (args: unknown) => Promise<string> {
  return async (args: unknown): Promise<string> =>
    tracer.startActiveSpan(`tool.${def.name}`, async (span) => {
      span.setAttribute('langfuse.observation.type', 'tool');
      span.setAttribute('langfuse.observation.input', JSON.stringify(args));
      span.setAttribute('tool.name', def.name);

      callbacks.onAgentStatus?.({
        agent: 'reasoner',
        state: 'tool',
        toolName: def.name,
        message: def.label,
      });

      const start = Date.now();
      try {
        const input = def.inputSchema.parse(args);
        validateToolCallAgainstPlan(def.name, input, callbacks.toolPlan);
        const result = await def.execute(input);
        if (callbacks.evidenceLedger) {
          observeToolResult(callbacks.evidenceLedger, def.name, result);
        }
        const durationMs = Date.now() - start;
        const resultStr = JSON.stringify(result, null, 2);
        const meta = def.traceMeta?.(result) ?? null;
        const artifact = def.extractArtifact?.(result) ?? null;
        const stepNum = callbacks.nextStep();
        const evidenceIds = def.extractEvidence(result);
        const step: StepTrace = {
          step: stepNum,
          toolName: def.name,
          toolInput: input,
          summary: def.summarize(result),
          evidenceIds,
          durationMs,
          ...(meta && { cypher: meta.cypher, params: meta.params, rowCount: meta.rowCount }),
        };

        span.setAttribute('langfuse.observation.output', resultStr);
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        callbacks.onStepTrace?.(step);
        if (artifact) callbacks.onReadinessDecision?.(artifact);
        const composedArtifact = await callbacks.readinessComposer?.observe(def.name, result);
        if (composedArtifact) callbacks.onReadinessDecision?.(composedArtifact);
        void callbacks.turnLogger?.logToolCall({
          step: stepNum,
          name: def.name,
          input,
          output: result,
          durationMs,
        });
        return resultStr;
      } catch (err) {
        const errorResult = toToolErrorResult(def.name, err);
        const resultStr = JSON.stringify(errorResult, null, 2);
        const durationMs = Date.now() - start;
        span.setAttribute('langfuse.observation.output', resultStr);
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorResult.error.message });
        span.recordException(err instanceof Error ? err : new Error(errorResult.error.message));
        span.end();

        callbacks.onAgentStatus?.({
          agent: 'reasoner',
          state: 'error',
          toolName: def.name,
          message: `${def.label} failed`,
        });
        const stepNum = callbacks.nextStep();
        callbacks.onStepTrace?.({
          step: stepNum,
          toolName: def.name,
          toolInput: args,
          summary: `${def.name} failed: ${errorResult.error.message}`,
          evidenceIds: [],
          durationMs,
        });
        void callbacks.turnLogger?.logToolCall({
          step: stepNum,
          name: def.name,
          input: args,
          output: errorResult,
          durationMs,
          error: errorResult.error.message,
        });
        return resultStr;
      }
    });
}
