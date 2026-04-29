import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { EvidenceFactNode } from '@/types/graph.types';
import {
  type CachedFact,
  readCachedFacts,
  writeCachedFacts,
} from './ocrLlmCache';

export const ALLOWED_FACT_KINDS = [
  'disability_period',
  'regulation_15',
  'nii_decision',
  'appeal_deadline',
  'required_document',
  'income_evidence',
  'medical_committee',
  'work_accident',
] as const;

export type LlmFactKind = (typeof ALLOWED_FACT_KINDS)[number];

const MAX_QUOTE_CHARS = 700;

const LlmFactKindSchema = z.enum(ALLOWED_FACT_KINDS);

/**
 * The prompt asks the model to return this shape. Validation happens after
 * `generateObject` so per-fact failures filter the bad rows out without
 * killing the whole batch.
 */
const LlmFactDraftSchema = z
  .object({
    kind: LlmFactKindSchema,
    subtype: z.union([z.string(), z.null()]).optional(),
    label: z.union([z.string(), z.null()]).optional(),
    value: z.union([z.string(), z.null()]).optional(),
    numericValue: z.union([z.number(), z.null()]).optional(),
    unit: z.union([z.string(), z.null()]).optional(),
    fromDate: z.union([z.string(), z.null()]).optional(),
    toDate: z.union([z.string(), z.null()]).optional(),
    confidence: z.union([z.number(), z.null()]).optional(),
    quote: z.string(),
  })
  .passthrough();

/**
 * The schema we hand to OpenAI's Structured Outputs. Every property must have
 * an explicit type; `additionalProperties` is forbidden; optional fields must
 * be modeled as nullable, not `.optional()`. Per-fact validation still happens
 * post-call via `validateLlmFact`, so this shape is intentionally a bit looser
 * than `LlmFactDraftSchema` (e.g. `kind` is a plain string here — we re-check
 * it against `ALLOWED_FACT_KINDS` after the call so the model doesn't 400 us
 * for an unknown kind).
 */
const ResponseFactSchema = z.object({
  kind: z.string(),
  subtype: z.string().nullable(),
  label: z.string().nullable(),
  value: z.string().nullable(),
  numericValue: z.number().nullable(),
  unit: z.string().nullable(),
  fromDate: z.string().nullable(),
  toDate: z.string().nullable(),
  confidence: z.number().nullable(),
  quote: z.string(),
});

const LlmResponseSchema = z.object({
  facts: z.array(ResponseFactSchema),
});

/**
 * Batched response shape: one entry per input chunk, identified by a
 * 0-based `chunkIndex`. Cross-chunk fact mis-attribution is caught downstream
 * by `quoteAppearsInText` — if the model puts a chunk-3 quote under
 * chunkIndex 1, the substring check rejects it.
 */
const ResponseChunkResultSchema = z.object({
  chunkIndex: z.number(),
  facts: z.array(ResponseFactSchema),
});

const BatchResponseSchema = z.object({
  results: z.array(ResponseChunkResultSchema),
});

export interface LlmExtractionInput {
  caseId: string;
  documentId: string;
  chunkId: string;
  chunkHash: string;
  text: string;
  observedDate: string | null;
}

export interface LlmCallStats {
  cached: boolean;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

interface LlmRunOptions {
  extractorVersion?: string;
  modelId?: string;
  onCallComplete?: (stats: LlmCallStats) => void;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function clampConfidence(raw: number | null | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0.7;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * "approximately appears" — case- and whitespace-insensitive substring check.
 * If the model paraphrased a quote, the chunk text won't contain it; reject
 * those rather than let an LLM-imagined snippet land in the graph.
 */
export function quoteAppearsInText(quote: string, text: string): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length < 6) return false;
  const haystack = normalizeForMatch(text);
  return haystack.includes(needle);
}

interface NormalizedFact {
  kind: LlmFactKind;
  subtype: string | null;
  label: string;
  value: string | null;
  numericValue: number | null;
  unit: string | null;
  fromDate: string | null;
  toDate: string | null;
  observedDate: string | null;
  confidence: number;
  quote: string;
  metadata: string | null;
}

/**
 * Parse one LLM-emitted fact and either return a normalized record or null
 * (rejection reasons are silent on purpose — bad LLM rows are quality, not
 * an error). Visible to tests so they can exercise each rejection path.
 */
export function validateLlmFact(
  raw: unknown,
  chunkText: string,
  observedDate: string | null
): NormalizedFact | null {
  const parsed = LlmFactDraftSchema.safeParse(raw);
  if (!parsed.success) return null;
  const draft = parsed.data;

  const quoteRaw = trimOrNull(draft.quote);
  if (!quoteRaw) return null;
  const quote = quoteRaw.slice(0, MAX_QUOTE_CHARS);
  if (!quoteAppearsInText(quote, chunkText)) return null;

  return {
    kind: draft.kind,
    subtype: trimOrNull(draft.subtype),
    label: trimOrNull(draft.label) ?? `${draft.kind}${draft.subtype ? `:${draft.subtype}` : ''}`,
    value: trimOrNull(draft.value),
    numericValue:
      typeof draft.numericValue === 'number' && Number.isFinite(draft.numericValue)
        ? draft.numericValue
        : null,
    unit: trimOrNull(draft.unit),
    fromDate: trimOrNull(draft.fromDate),
    toDate: trimOrNull(draft.toDate),
    observedDate,
    confidence: clampConfidence(draft.confidence ?? null),
    quote,
    metadata: JSON.stringify({ extractor: 'openai_llm' }),
  };
}

function cachedFactToNormalized(cached: CachedFact, observedDate: string | null): NormalizedFact | null {
  const kindParse = LlmFactKindSchema.safeParse(cached.kind);
  if (!kindParse.success) return null;
  return {
    kind: kindParse.data,
    subtype: cached.subtype,
    label: cached.label,
    value: cached.value,
    numericValue: cached.numericValue,
    unit: cached.unit,
    fromDate: cached.fromDate,
    toDate: cached.toDate,
    observedDate: observedDate ?? cached.observedDate ?? null,
    confidence: cached.confidence,
    quote: cached.quote,
    metadata: cached.metadata,
  };
}

function normalizedToNode(
  fact: NormalizedFact,
  input: LlmExtractionInput,
  index: number,
  extractorVersion: string
): EvidenceFactNode {
  return {
    factId: `${input.chunkId}:llm:${index + 1}`,
    caseId: input.caseId,
    documentId: input.documentId,
    chunkId: input.chunkId,
    kind: fact.kind,
    subtype: fact.subtype,
    label: fact.label,
    value: fact.value,
    numericValue: fact.numericValue,
    unit: fact.unit,
    fromDate: fact.fromDate,
    toDate: fact.toDate,
    observedDate: fact.observedDate,
    confidence: fact.confidence,
    quote: fact.quote,
    metadata: fact.metadata,
    source: 'llm',
    extractorVersion,
    chunkHash: input.chunkHash,
  };
}

function normalizedToCachedFact(fact: NormalizedFact): CachedFact {
  return {
    kind: fact.kind,
    subtype: fact.subtype,
    label: fact.label,
    value: fact.value,
    numericValue: fact.numericValue,
    unit: fact.unit,
    fromDate: fact.fromDate,
    toDate: fact.toDate,
    observedDate: fact.observedDate,
    confidence: fact.confidence,
    quote: fact.quote,
    metadata: fact.metadata,
  };
}

const PROMPT_RULES = [
  'You are an Israeli personal-injury legal evidence extractor.',
  'Only emit facts that are literally supported by the text. Do not infer, paraphrase, or summarise.',
  '',
  'Allowed fact kinds (use exactly these strings for "kind"):',
  '- disability_period (subtype: "permanent" | "temporary" | "mentioned"; numericValue is the percent if stated; fromDate/toDate as YYYY-MM-DD if stated)',
  '- regulation_15 (subtype: "applied" | "not_applied" | "mentioned")',
  '- nii_decision (subtype: "rejected" | "accepted" | "committee_decision" | "appeal_notice"; National-Insurance / ביטוח לאומי decisions only)',
  '- appeal_deadline (subtype: "days" | "months"; numericValue + unit when a deadline duration is stated)',
  '- required_document (subtype: a short snake_case slug like salary_slips, employer_letter, medical_records, btl_250_form, police_report, occupational_doctor, imaging_discs)',
  '- income_evidence (subtype: income_reduction | reduced_work_capacity | salary_slips | returned_to_work | employer_letter)',
  '- medical_committee (subtype: a Hebrew specialty if stated, otherwise "committee")',
  '- work_accident (subtype: work_injury_claim | work_accident | injury_allowance | injury_date)',
  '',
  'For every fact, "quote" must be a verbatim Hebrew/English snippet from THAT chunk\'s text (max 700 chars). If you cannot find a verbatim snippet, omit the fact.',
  '"confidence" must be a number between 0 and 1 expressing how certain the snippet supports the fact.',
  'Set unused fields to null. Do NOT invent dates, percentages, or document names.',
];

function buildPrompt(text: string): string {
  return [
    ...PROMPT_RULES,
    '',
    'Emit a JSON object under the "facts" key.',
    '',
    'Chunk text:',
    '"""',
    text,
    '"""',
  ].join('\n');
}

function buildBatchPrompt(texts: string[]): string {
  const chunkBlocks = texts.map(
    (text, index) => `CHUNK ${index}:\n"""\n${text}\n"""`
  );
  return [
    ...PROMPT_RULES,
    '',
    `You will receive ${texts.length} chunks. Extract facts independently for each one.`,
    'Return JSON of shape { "results": [{ "chunkIndex": <number>, "facts": [...] }, ...] }.',
    `Emit exactly one entry per chunkIndex from 0 to ${texts.length - 1}, in order. Use "facts": [] for chunks with nothing to extract.`,
    'A "quote" must come verbatim from the chunk it is attributed to — never copy text across chunks.',
    '',
    chunkBlocks.join('\n\n'),
  ].join('\n');
}

interface CallResult {
  facts: unknown[];
  inputTokens: number;
  outputTokens: number;
}

interface BatchCallResult {
  resultsByIndex: Map<number, unknown[]>;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Optional injection seam for tests — when set, this is called instead of
 * the real `generateObject(...)` round-trip. Production callers never set it.
 */
let llmCallOverride:
  | ((input: LlmExtractionInput, modelId: string) => Promise<CallResult>)
  | null = null;

let llmBatchCallOverride:
  | ((inputs: LlmExtractionInput[], modelId: string) => Promise<BatchCallResult>)
  | null = null;

export function setLlmCallOverrideForTests(
  fn: ((input: LlmExtractionInput, modelId: string) => Promise<CallResult>) | null
): void {
  llmCallOverride = fn;
}

export function setLlmBatchCallOverrideForTests(
  fn: ((inputs: LlmExtractionInput[], modelId: string) => Promise<BatchCallResult>) | null
): void {
  llmBatchCallOverride = fn;
}

function readUsageNumber(usage: unknown, key: string): number {
  if (usage && typeof usage === 'object') {
    const value = (usage as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

async function callOpenAI(
  input: LlmExtractionInput,
  modelId: string
): Promise<CallResult> {
  if (llmCallOverride) return llmCallOverride(input, modelId);
  const result = await generateObject({
    model: openai(modelId),
    schema: LlmResponseSchema,
    prompt: buildPrompt(input.text),
  });
  const parsed = LlmResponseSchema.safeParse(result.object);
  // Different AI SDK versions expose token counts under different keys; check both.
  const inputTokens =
    readUsageNumber(result.usage, 'inputTokens') ||
    readUsageNumber(result.usage, 'promptTokens');
  const outputTokens =
    readUsageNumber(result.usage, 'outputTokens') ||
    readUsageNumber(result.usage, 'completionTokens');
  return {
    facts: parsed.success ? parsed.data.facts : [],
    inputTokens,
    outputTokens,
  };
}

async function callOpenAIBatch(
  inputs: LlmExtractionInput[],
  modelId: string
): Promise<BatchCallResult> {
  if (llmBatchCallOverride) return llmBatchCallOverride(inputs, modelId);
  const result = await generateObject({
    model: openai(modelId),
    schema: BatchResponseSchema,
    prompt: buildBatchPrompt(inputs.map((input) => input.text)),
  });
  const parsed = BatchResponseSchema.safeParse(result.object);
  const inputTokens =
    readUsageNumber(result.usage, 'inputTokens') ||
    readUsageNumber(result.usage, 'promptTokens');
  const outputTokens =
    readUsageNumber(result.usage, 'outputTokens') ||
    readUsageNumber(result.usage, 'completionTokens');
  const resultsByIndex = new Map<number, unknown[]>();
  if (parsed.success) {
    for (const entry of parsed.data.results) {
      if (Number.isInteger(entry.chunkIndex) && entry.chunkIndex >= 0) {
        resultsByIndex.set(entry.chunkIndex, entry.facts);
      }
    }
  }
  return { resultsByIndex, inputTokens, outputTokens };
}

export function resolveExtractorVersion(env: NodeJS.ProcessEnv = process.env): string {
  return env.OCR_LLM_EXTRACTOR_VERSION?.trim() || 'openai-ocr-v1';
}

function resolveModelId(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
}

export async function extractEvidenceFactsWithLLM(
  input: LlmExtractionInput,
  options: LlmRunOptions = {}
): Promise<EvidenceFactNode[]> {
  const text = input.text.trim();
  if (!text) return [];

  const extractorVersion = options.extractorVersion ?? resolveExtractorVersion();
  const modelId = options.modelId ?? resolveModelId();
  const start = Date.now();

  const cached = await readCachedFacts(extractorVersion, input.chunkHash);
  if (cached !== null) {
    const remapped = cached
      .map((entry) => cachedFactToNormalized(entry, input.observedDate))
      .filter((fact): fact is NormalizedFact => fact !== null)
      .map((fact, index) => normalizedToNode(fact, input, index, extractorVersion));
    options.onCallComplete?.({
      cached: true,
      durationMs: Date.now() - start,
      inputTokens: 0,
      outputTokens: 0,
    });
    return remapped;
  }

  const raw = await callOpenAI(input, modelId);
  const normalized = raw.facts
    .map((entry) => validateLlmFact(entry, text, input.observedDate))
    .filter((fact): fact is NormalizedFact => fact !== null);

  await writeCachedFacts(
    extractorVersion,
    input.chunkHash,
    normalized.map(normalizedToCachedFact)
  );

  options.onCallComplete?.({
    cached: false,
    durationMs: Date.now() - start,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
  });
  return normalized.map((fact, index) => normalizedToNode(fact, input, index, extractorVersion));
}

/**
 * Batched extraction. Given N chunks, this:
 *   1. Reads the file cache for each chunk (skipping any cache hits).
 *   2. Sends the *uncached* subset in a single OpenAI call.
 *   3. Validates each chunk's facts independently against its own text.
 *   4. Writes the cache and emits one `onCallComplete` event per input.
 * Returns one `EvidenceFactNode[]` per input, in the same order. Failures of
 * the OpenAI call propagate to the caller, which is responsible for the
 * try/catch + graceful degradation policy.
 */
export async function extractEvidenceFactsBatchWithLLM(
  inputs: LlmExtractionInput[],
  options: LlmRunOptions = {}
): Promise<EvidenceFactNode[][]> {
  if (inputs.length === 0) return [];

  const extractorVersion = options.extractorVersion ?? resolveExtractorVersion();
  const modelId = options.modelId ?? resolveModelId();

  const results: EvidenceFactNode[][] = new Array(inputs.length);
  const uncachedIndices: number[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const text = input.text.trim();
    if (!text) {
      results[i] = [];
      options.onCallComplete?.({ cached: true, durationMs: 0, inputTokens: 0, outputTokens: 0 });
      continue;
    }
    const callStart = Date.now();
    const cached = await readCachedFacts(extractorVersion, input.chunkHash);
    if (cached !== null) {
      results[i] = cached
        .map((entry) => cachedFactToNormalized(entry, input.observedDate))
        .filter((fact): fact is NormalizedFact => fact !== null)
        .map((fact, index) => normalizedToNode(fact, input, index, extractorVersion));
      options.onCallComplete?.({
        cached: true,
        durationMs: Date.now() - callStart,
        inputTokens: 0,
        outputTokens: 0,
      });
      continue;
    }
    uncachedIndices.push(i);
  }

  if (uncachedIndices.length === 0) return results;

  const apiInputs = uncachedIndices.map((i) => inputs[i]!);
  const callStart = Date.now();
  const raw = await callOpenAIBatch(apiInputs, modelId);
  const callDuration = Date.now() - callStart;
  // Spread token usage roughly evenly across the batch so per-chunk progress
  // numbers are sensible even though the API call itself is shared.
  const perCallInputTokens =
    apiInputs.length > 0 ? Math.round(raw.inputTokens / apiInputs.length) : 0;
  const perCallOutputTokens =
    apiInputs.length > 0 ? Math.round(raw.outputTokens / apiInputs.length) : 0;
  const perCallDuration =
    apiInputs.length > 0 ? Math.round(callDuration / apiInputs.length) : 0;

  for (let j = 0; j < apiInputs.length; j++) {
    const input = apiInputs[j]!;
    const originalIndex = uncachedIndices[j]!;
    const text = input.text.trim();
    const factDrafts = raw.resultsByIndex.get(j) ?? [];
    const normalized = factDrafts
      .map((entry) => validateLlmFact(entry, text, input.observedDate))
      .filter((fact): fact is NormalizedFact => fact !== null);

    await writeCachedFacts(
      extractorVersion,
      input.chunkHash,
      normalized.map(normalizedToCachedFact)
    );

    results[originalIndex] = normalized.map((fact, index) =>
      normalizedToNode(fact, input, index, extractorVersion)
    );

    options.onCallComplete?.({
      cached: false,
      durationMs: perCallDuration,
      inputTokens: perCallInputTokens,
      outputTokens: perCallOutputTokens,
    });
  }

  return results;
}

export function llmOcrFactsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_LLM_OCR_FACTS === 'true';
}
