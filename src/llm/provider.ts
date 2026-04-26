import { openai } from '@ai-sdk/openai';
import { createVertex } from '@ai-sdk/google-vertex';
import type { EmbeddingModel, LanguageModel } from 'ai';

export type LlmProviderName = 'vertex' | 'openai';

export interface LlmResolution {
  provider: LlmProviderName;
  modelId: string;
}

const DEFAULT_VERTEX_MODEL = 'gemini-2.5-pro';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1';
// text-embedding-004 has a much higher default per-project quota (~600 RPM) than
// gemini-embedding-001 (~5 RPM on new projects). Both produce 768-dim vectors.
const DEFAULT_VERTEX_EMBEDDING_MODEL = 'text-embedding-004';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

function hasVertexEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.GOOGLE_VERTEX_PROJECT ||
      env.GOOGLE_VERTEX_API_KEY ||
      env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

export function resolveLlm(env: NodeJS.ProcessEnv = process.env): LlmResolution {
  const explicit = env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit && explicit !== 'vertex' && explicit !== 'openai') {
    throw new Error('LLM_PROVIDER must be either "vertex" or "openai"');
  }
  if (!explicit && env.NODE_ENV === 'production') {
    throw new Error('LLM_PROVIDER is required in production');
  }

  const provider: LlmProviderName =
    explicit === 'vertex' || explicit === 'openai'
      ? explicit
      : hasVertexEnv(env)
        ? 'vertex'
        : 'openai';

  return {
    provider,
    modelId:
      env.LLM_MODEL?.trim() ||
      (provider === 'vertex' ? DEFAULT_VERTEX_MODEL : DEFAULT_OPENAI_MODEL),
  };
}

function createVertexProvider(env: NodeJS.ProcessEnv = process.env) {
  return createVertex({
    project: env.GOOGLE_VERTEX_PROJECT,
    location: env.GOOGLE_VERTEX_LOCATION,
    apiKey: env.GOOGLE_VERTEX_API_KEY,
  });
}

export function getLanguageModel(env: NodeJS.ProcessEnv = process.env): LanguageModel {
  const resolved = resolveLlm(env);
  if (resolved.provider === 'vertex') {
    return createVertexProvider(env)(resolved.modelId as Parameters<ReturnType<typeof createVertex>>[0]);
  }
  return openai(resolved.modelId);
}

export interface EmbeddingResolution {
  provider: LlmProviderName;
  modelId: string;
}

export function resolveEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env
): EmbeddingResolution {
  const explicit = env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (explicit && explicit !== 'vertex' && explicit !== 'openai') {
    throw new Error('EMBEDDING_PROVIDER must be either "vertex" or "openai"');
  }
  const provider: LlmProviderName =
    explicit === 'vertex' || explicit === 'openai'
      ? explicit
      : hasVertexEnv(env)
        ? 'vertex'
        : 'openai';
  if (provider === 'vertex') {
    return {
      provider,
      modelId: env.VERTEX_EMBEDDING_MODEL?.trim() || DEFAULT_VERTEX_EMBEDDING_MODEL,
    };
  }
  return {
    provider,
    modelId: env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_OPENAI_EMBEDDING_MODEL,
  };
}

export function getEmbeddingModel(
  modelId?: string,
  env: NodeJS.ProcessEnv = process.env
): EmbeddingModel {
  const resolved = resolveEmbeddingProvider(env);
  const id = modelId ?? resolved.modelId;
  if (resolved.provider === 'vertex') {
    return createVertexProvider(env).textEmbeddingModel(
      id as Parameters<ReturnType<typeof createVertex>['textEmbeddingModel']>[0]
    );
  }
  return openai.textEmbeddingModel(id);
}

export function semanticSimilarityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SEMANTIC_SIMILARITY_ENABLED === 'true';
}
