import {
  ToolLoopAgent,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
  type StreamTextResult,
  type ToolSet,
} from 'ai';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  resolveCaseReasonerMcpSystemPrompt,
  resolveCaseReasonerSystemPrompt,
} from '@/prompts/resolveFromLangfuse';
import { buildAgentToolRuntime } from '@/tools/registry';
import type { OnAgentStatus, OnReadinessDecision, OnStepTrace } from '@/types/stream.types';
import type { TurnLogger } from '@/utils/turnLogger';
import { getLanguageModel } from '@/llm/provider';
import { planTurn, routeInstruction } from './intentPlanner';
import { createEvidenceLedger } from './evidenceLedger';
import { getAgentToolMode } from '@/tools/toolMode';

const tracer = trace.getTracer('caseReasoner', '1.0.0');

export async function streamCaseReasonerResponse(
  messages: UIMessage[],
  onAgentStatus?: OnAgentStatus,
  onStepTrace?: OnStepTrace,
  onReadinessDecision?: OnReadinessDecision,
  turnLogger?: TurnLogger
): Promise<StreamTextResult<ToolSet, never>> {
  return tracer.startActiveSpan('caseReasoner.stream', async (parentSpan) => {
    parentSpan.setAttribute('langfuse.observation.type', 'agent');
    parentSpan.setAttribute('langfuse.trace.name', 'caseReasonerResponse');

    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const userPromptText =
      lastUserMessage?.parts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .trim() ?? '';
    const toolMode = getAgentToolMode();
    const toolPlan = toolMode === 'atomic' ? planTurn(userPromptText) : undefined;
    const evidenceLedger = createEvidenceLedger();
    const toolRuntime = await buildAgentToolRuntime(
      onAgentStatus,
      onStepTrace,
      onReadinessDecision,
      turnLogger,
      toolPlan,
      evidenceLedger
    );

    onAgentStatus?.({ agent: 'reasoner', state: 'working', message: 'Reasoning about case...' });

    parentSpan.setAttribute('langfuse.observation.input', userPromptText);
    parentSpan.setAttribute('caseReasoner.toolMode', toolRuntime.mode);
    parentSpan.setAttribute('caseReasoner.toolNames', toolRuntime.toolNames.join(','));
    if (toolPlan) {
      parentSpan.setAttribute('caseReasoner.intent', toolPlan.intent);
      parentSpan.setAttribute('caseReasoner.requiredTools', toolPlan.requiredTools.join(','));
    }

    const instructions =
      toolMode === 'mcp'
        ? resolveCaseReasonerMcpSystemPrompt()
        : `${await resolveCaseReasonerSystemPrompt()}\n\n${routeInstruction(toolPlan ?? planTurn(userPromptText))}`;

    const agent = new ToolLoopAgent<never, ToolSet, never>({
      model: getLanguageModel(),
      instructions,
      tools: toolRuntime.tools,
      stopWhen: stepCountIs(12),
      onFinish: async () => {
        await toolRuntime.close();
      },
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'caseReasoner',
      },
    });

    const modelMessages = await convertToModelMessages(messages);
    let result: StreamTextResult<ToolSet, never>;
    try {
      result = await agent.stream({
        messages: modelMessages,
      });
    } catch (error) {
      await toolRuntime.close();
      throw error;
    }

    parentSpan.setStatus({ code: SpanStatusCode.OK });
    parentSpan.end();

    return result;
  });
}
