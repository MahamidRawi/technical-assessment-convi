import { LangfuseClient } from '@langfuse/client';
import {
  LANGFUSE_PROMPT_CASE_REASONER_SYSTEM,
  langfuseToolDescriptionPromptName,
} from '@/prompts/promptNames';
import {
  DEFAULT_CASE_REASONER_MCP_SYSTEM_PROMPT,
  DEFAULT_CASE_REASONER_SYSTEM_PROMPT_CLEAN,
  getDefaultToolDescription,
} from '@/prompts/defaultPrompts';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Langfuse');

let langfuse: LangfuseClient | undefined;

function getLangfuseClient(): LangfuseClient | null {
  if (langfuse) {
    return langfuse;
  }
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) {
    return null;
  }
  langfuse = new LangfuseClient();
  return langfuse;
}

const promptLabelOptions = () => {
  const label = process.env.LANGFUSE_PROMPT_LABEL?.trim();
  return label ? { label } : {};
};

const REQUIRED_SYSTEM_PROMPT_SNIPPETS = [
  'Answer from graph evidence',
  'rankSimilarCasePairs',
  'getObservedStageTransitions',
  'knownStageTaxonomy',
  'Frequency is not severity',
];

function hasRequiredSystemPromptGuardrails(prompt: string): boolean {
  return REQUIRED_SYSTEM_PROMPT_SNIPPETS.every((snippet) => prompt.includes(snippet));
}

export async function resolveCaseReasonerSystemPrompt(): Promise<string> {
  const client = getLangfuseClient();
  if (!client) {
    return DEFAULT_CASE_REASONER_SYSTEM_PROMPT_CLEAN;
  }

  try {
    const prompt = await client.prompt.get(LANGFUSE_PROMPT_CASE_REASONER_SYSTEM, {
      type: 'text',
      ...promptLabelOptions(),
    });

    const compiled = prompt.compile();
    if (!hasRequiredSystemPromptGuardrails(compiled)) {
      logger.warn('Resolved Langfuse system prompt is missing required guardrails; using local clean fallback.');
      return DEFAULT_CASE_REASONER_SYSTEM_PROMPT_CLEAN;
    }
    return compiled;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to resolve system prompt, using local fallback: ${message}`);
    return DEFAULT_CASE_REASONER_SYSTEM_PROMPT_CLEAN;
  }
}

export function resolveCaseReasonerMcpSystemPrompt(): string {
  return DEFAULT_CASE_REASONER_MCP_SYSTEM_PROMPT;
}

export async function resolveToolDescription(toolName: string): Promise<string> {
  const client = getLangfuseClient();
  const fallback = getDefaultToolDescription(toolName);
  if (!client) {
    if (fallback) return fallback;
    throw new Error(`No local tool description for "${toolName}"`);
  }

  try {
    const p = await client.prompt.get(langfuseToolDescriptionPromptName(toolName), {
      type: 'text',
      ...promptLabelOptions(),
    });
    return p.compile();
  } catch (err) {
    if (fallback) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to resolve tool description "${toolName}", using local fallback: ${message}`);
      return fallback;
    }
    throw err;
  }
}

export async function resolveToolDescriptions(
  toolNames: readonly string[]
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    toolNames.map(async (name) => {
      const text = await resolveToolDescription(name);
      return [name, text] as const;
    })
  );
  return Object.fromEntries(entries);
}
