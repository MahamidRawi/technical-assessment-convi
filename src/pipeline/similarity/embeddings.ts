import { embed } from 'ai';
import { createLogger } from '@/utils/logger';
import {
  getEmbeddingModel,
  resolveEmbeddingProvider,
  semanticSimilarityEnabled,
} from '@/llm/provider';
import type { CaseSignals, SimilarityMethod } from './types';

const logger = createLogger('Similarity');
const EMBEDDING_DIMENSIONS = 768;
const DEFAULT_DELAY_MS = 1500;

type ProviderOptions = Record<string, Record<string, number>>;

/**
 * Per-provider option to request a 768-dim vector. Returned shape matches the AI SDK's
 * `providerOptions` field for the resolved provider; returns undefined when the model
 * is fixed-size (e.g. text-embedding-004 always returns 768 and rejects the option).
 */
function dimensionalityOption(): ProviderOptions | undefined {
  const { provider, modelId } = resolveEmbeddingProvider();
  if (provider === 'vertex' && modelId.startsWith('gemini-embedding')) {
    return { vertex: { outputDimensionality: EMBEDDING_DIMENSIONS } };
  }
  if (provider === 'openai' && modelId.startsWith('text-embedding-3')) {
    return { openai: { dimensions: EMBEDDING_DIMENSIONS } };
  }
  return undefined;
}

// Inputs to the embedding model. Deliberately structured (no free-text narrative) so
// nothing leaves the project that the user can't reconstruct from the graph itself.
// `caseName` is included because it carries the client surname; if that is unacceptable
// for the destination provider, drop it here too. `aiGeneratedSummary` is intentionally
// NOT included — it can carry raw client narrative including names, dates, and other PII.
function caseEmbeddingText(row: CaseSignals): string {
  return [
    row.caseName,
    row.caseType,
    row.legalStage,
    row.injuries.join(', '),
    row.bodyParts.join(', '),
    row.insurers.join(', '),
    row.documentCategories.join(', '),
    row.documentTypes.join(', '),
  ]
    .filter(Boolean)
    .join('\n');
}

function embeddingDelayMs(): number {
  const raw = process.env.EMBEDDING_REQUEST_DELAY_MS;
  if (!raw) return DEFAULT_DELAY_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DELAY_MS;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function maybeAttachEmbeddings(cases: CaseSignals[]): Promise<SimilarityMethod> {
  if (!semanticSimilarityEnabled()) return 'signal';
  const delayMs = embeddingDelayMs();
  try {
    const model = getEmbeddingModel();
    const providerOptions = dimensionalityOption();
    for (let i = 0; i < cases.length; i++) {
      const row = cases[i];
      if (!row) continue;
      if (i > 0 && delayMs > 0) await sleep(delayMs);
      const result = await embed({
        model,
        value: caseEmbeddingText(row),
        ...(providerOptions && { providerOptions }),
      });
      row.embedding = result.embedding;
    }
    return 'signal+semantic';
  } catch (error: unknown) {
    logger.warn(
      'Semantic similarity disabled after embedding failure:',
      error instanceof Error ? error.message : error
    );
    for (const row of cases) row.embedding = null;
    return 'signal';
  }
}
