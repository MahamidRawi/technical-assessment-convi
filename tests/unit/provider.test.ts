import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLlm, semanticSimilarityEnabled } from '@/llm/provider';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', ...values } as unknown as NodeJS.ProcessEnv;
}

test('resolveLlm honors explicit Vertex provider and default model', () => {
  const resolved = resolveLlm(env({ LLM_PROVIDER: 'vertex' }));
  assert.deepEqual(resolved, { provider: 'vertex', modelId: 'gemini-2.5-pro' });
});

test('resolveLlm uses OpenAI local fallback without Vertex env', () => {
  const resolved = resolveLlm(env({ NODE_ENV: 'development' }));
  assert.deepEqual(resolved, { provider: 'openai', modelId: 'gpt-4.1' });
});

test('resolveLlm auto-detects Vertex in development when Vertex env exists', () => {
  const resolved = resolveLlm(env({
    NODE_ENV: 'development',
    GOOGLE_VERTEX_PROJECT: 'case-graph-dev',
  }));
  assert.deepEqual(resolved, { provider: 'vertex', modelId: 'gemini-2.5-pro' });
});

test('resolveLlm applies model override', () => {
  const resolved = resolveLlm(env({
    LLM_PROVIDER: 'openai',
    LLM_MODEL: 'custom-model',
  }));
  assert.deepEqual(resolved, { provider: 'openai', modelId: 'custom-model' });
});

test('resolveLlm rejects invalid provider and missing production provider', () => {
  assert.throws(
    () => resolveLlm(env({ LLM_PROVIDER: 'anthropic' })),
    /LLM_PROVIDER must be either/
  );
  assert.throws(
    () => resolveLlm(env({ NODE_ENV: 'production' })),
    /LLM_PROVIDER is required/
  );
});

test('semanticSimilarityEnabled is opt-in only', () => {
  assert.equal(semanticSimilarityEnabled(env({ SEMANTIC_SIMILARITY_ENABLED: 'true' })), true);
  assert.equal(semanticSimilarityEnabled(env({ SEMANTIC_SIMILARITY_ENABLED: 'false' })), false);
});
