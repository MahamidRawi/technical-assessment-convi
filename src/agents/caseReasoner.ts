import {
  ToolLoopAgent,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
  type StreamTextResult,
  type ToolSet,
} from 'ai';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { resolveCaseReasonerSystemPrompt } from '@/prompts/resolveFromLangfuse';
import { buildAgentTools } from '@/tools/registry';
import type { OnAgentStatus, OnReadinessDecision, OnStepTrace } from '@/types/stream.types';
import type { TurnLogger } from '@/utils/turnLogger';
import { getLanguageModel } from '@/llm/provider';
import { buildTurnToolPolicy, nextRequiredTool } from './toolPolicy';

const tracer = trace.getTracer('caseReasoner', '1.0.0');

export async function streamCaseReasonerResponse(
  messages: UIMessage[],
  onAgentStatus?: OnAgentStatus,
  onStepTrace?: OnStepTrace,
  onReadinessDecision?: OnReadinessDecision,
  turnLogger?: TurnLogger
): Promise<StreamTextResult<ToolSet, never>> {
  const tools = await buildAgentTools(onAgentStatus, onStepTrace, onReadinessDecision, turnLogger);

  onAgentStatus?.({ agent: 'reasoner', state: 'working', message: 'Reasoning about case...' });

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
    parentSpan.setAttribute('langfuse.observation.input', userPromptText);

    const instructions = await resolveCaseReasonerSystemPrompt();
    const turnToolPolicy = buildTurnToolPolicy(userPromptText);
    const effectiveInstructions = turnToolPolicy
      ? `${instructions}\n\n${turnToolPolicy.instructionSuffix}`
      : instructions;

    const agent = new ToolLoopAgent<never, ToolSet, never>({
      model: getLanguageModel(),
      instructions: effectiveInstructions,
      tools,
      ...(turnToolPolicy && {
        activeTools: turnToolPolicy.activeTools,
        prepareStep: ({ steps }) => {
          const calledTools = steps.flatMap((step) =>
            step.toolCalls.map((call) => String(call.toolName))
          );
          const nextTool = nextRequiredTool(turnToolPolicy.requiredToolSequence, calledTools);
          if (!nextTool) return { activeTools: turnToolPolicy.activeTools };
          return {
            activeTools: [nextTool],
            toolChoice: { type: 'tool' as const, toolName: nextTool },
          };
        },
      }),
      stopWhen: stepCountIs(12),
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'caseReasoner',
      },
    });

    const modelMessages = await convertToModelMessages(messages);
    const result = await agent.stream({
      messages: modelMessages,
    });

    parentSpan.setStatus({ code: SpanStatusCode.OK });
    parentSpan.end();

    return result;
  });
}
