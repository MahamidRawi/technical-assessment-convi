import { tool, type ToolSet } from 'ai';
import type { z } from 'zod';
import { resolveToolDescriptions } from '@/prompts/resolveFromLangfuse';
import type { OnAgentStatus, OnReadinessDecision, OnStepTrace } from '@/types/stream.types';
import type { TurnLogger } from '@/utils/turnLogger';
import { TOOL_ENTRIES, forEachTool } from './toolCatalog';
import { createToolExecute } from './toolRunner';
import type { ToolDefinition } from './types';
import { ReadinessArtifactComposer } from './readiness/artifactComposer';

export { TOOL_ENTRIES };

export async function buildAgentTools(
  onAgentStatus?: OnAgentStatus,
  onStepTrace?: OnStepTrace,
  onReadinessDecision?: OnReadinessDecision,
  turnLogger?: TurnLogger
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
