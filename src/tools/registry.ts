import { tool, type ToolSet } from 'ai';
import type { z } from 'zod';
import { resolveToolDescriptions } from '@/prompts/resolveFromLangfuse';
import type { OnAgentStatus, OnReadinessDecision, OnStepTrace } from '@/types/stream.types';
import type { TurnLogger } from '@/utils/turnLogger';
import { TOOL_ENTRIES, forEachTool } from './toolCatalog';
import { createToolExecute } from './toolRunner';
import type { ToolDefinition } from './types';
import { ReadinessArtifactComposer } from './readiness/artifactComposer';
import type { ToolPlan } from '@/agents/intentPlanner';
import type { EvidenceLedger } from '@/agents/evidenceLedger';
import { getAgentToolMode, type AgentToolMode } from './toolMode';
import { buildNeo4jMcpToolRuntime } from './mcpNeo4j';

export { TOOL_ENTRIES };

export interface AgentToolRuntime {
  mode: AgentToolMode;
  tools: ToolSet;
  toolNames: string[];
  close(): Promise<void>;
}

export async function buildAgentTools(
  onAgentStatus?: OnAgentStatus,
  onStepTrace?: OnStepTrace,
  onReadinessDecision?: OnReadinessDecision,
  turnLogger?: TurnLogger,
  toolPlan?: ToolPlan,
  evidenceLedger?: EvidenceLedger
): Promise<ToolSet> {
  let stepCounter = 0;
  const readinessComposer = onReadinessDecision ? new ReadinessArtifactComposer() : undefined;
  const descriptions = await resolveToolDescriptions(TOOL_ENTRIES.map((entry) => entry.name));
  const tools: ToolSet = {};

  const addTool = <TSchema extends z.ZodTypeAny, TResult>(
    def: ToolDefinition<TSchema, TResult>
  ): void => {
    const description = descriptions[def.name];
    if (!description.trim()) {
      throw new Error(
        `No description available for tool "${def.name}" - set a local fallback or Langfuse prompt.`
      );
    }
    tools[def.name] = tool({
      description,
      inputSchema: def.inputSchema,
      execute: createToolExecute(def, {
        onAgentStatus,
        onStepTrace,
        onReadinessDecision,
        turnLogger,
        readinessComposer,
        toolPlan,
        evidenceLedger,
        nextStep: () => {
          stepCounter += 1;
          return stepCounter;
        },
      }),
    });
  };

  forEachTool(addTool);

  return tools;
}

export async function buildAgentToolRuntime(
  onAgentStatus?: OnAgentStatus,
  onStepTrace?: OnStepTrace,
  onReadinessDecision?: OnReadinessDecision,
  turnLogger?: TurnLogger,
  toolPlan?: ToolPlan,
  evidenceLedger?: EvidenceLedger
): Promise<AgentToolRuntime> {
  const mode = getAgentToolMode();
  if (mode === 'atomic') {
    const tools = await buildAgentTools(
      onAgentStatus,
      onStepTrace,
      onReadinessDecision,
      turnLogger,
      toolPlan,
      evidenceLedger
    );
    return {
      mode,
      tools,
      toolNames: Object.keys(tools),
      close: async () => {},
    };
  }

  let stepCounter = 0;
  const runtime = await buildNeo4jMcpToolRuntime({
    onAgentStatus,
    onStepTrace,
    onReadinessDecision,
    turnLogger,
    toolPlan,
    evidenceLedger,
    nextStep: () => {
      stepCounter += 1;
      return stepCounter;
    },
  });
  return {
    mode,
    tools: runtime.tools,
    toolNames: runtime.toolNames,
    close: runtime.close,
  };
}
