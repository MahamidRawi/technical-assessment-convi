import crypto from 'node:crypto';
import type { Db } from 'mongodb';
import type { Session } from 'neo4j-driver';
import {
  MongoFileSchema,
  extractISODate,
  extractSourceId,
  type MongoFile,
} from '@/types/mongo.types';
import type { DocumentChunkNode, EvidenceFactNode } from '@/types/graph.types';
import { readCollection } from '@/db/mongo';
import { createLogger } from '@/utils/logger';
import { resolveFileCaseId } from './normalize';
import { extractEvidenceFacts } from './ocrFacts';
import {
  extractEvidenceFactsBatchWithLLM,
  llmOcrFactsEnabled,
  resolveExtractorVersion,
  type LlmCallStats,
  type LlmExtractionInput,
} from './llmEvidenceFacts';
import { mergeEvidenceFacts } from './mergeEvidenceFacts';

const logger = createLogger('Ingest');
const TARGET_CHARS = 2200;
const MAX_CHARS = 2600;
const OVERLAP_CHARS = 180;
const TEXT_PREVIEW_CHARS = 700;
const WRITE_BATCH_SIZE = 400;
const LLM_CONCURRENCY_DEFAULT = 8;
const LLM_BATCH_SIZE_DEFAULT = 5;
const REGEX_EXTRACTOR_VERSION = 'regex-v1';
const PROGRESS_EVERY_DEFAULT = 25;
const PROGRESS_MIN_INTERVAL_MS = 5_000;

function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * Approximate per-million-token prices (USD) for the models we expect to see.
 * Numbers are rounded; OpenAI updates pricing periodically. Override with
 * `OCR_LLM_PRICE_INPUT_PER_MTOK` / `OCR_LLM_PRICE_OUTPUT_PER_MTOK`.
 */
const MODEL_PRICE_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
};

export function hashNormalizedText(text: string): string {
  return crypto
    .createHash('sha256')
    .update(text.trim().replace(/\s+/g, ' '))
    .digest('hex');
}

interface SourceText {
  text: string;
  source: string;
  pageRange: string | null;
  gcsUri: string | null;
  summary: string | null;
}

function compactText(value: string): string {
  return value.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n').trim();
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function pagePart(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return nonEmpty(value);
  return null;
}

export function normalizePageRange(value: unknown): string | null {
  if (typeof value === 'string') return nonEmpty(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const range = value as Record<string, unknown>;
  const start = pagePart(range.start);
  const end = pagePart(range.end);
  if (start && end) return start === end ? start : `${start}-${end}`;
  return start ?? end;
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_CHARS) return [paragraph];
  const parts: string[] = [];
  for (let start = 0; start < paragraph.length; start += TARGET_CHARS) {
    parts.push(paragraph.slice(start, start + TARGET_CHARS));
  }
  return parts;
}

export function splitTextIntoChunks(text: string): string[] {
  const clean = compactText(text);
  if (!clean) return [];
  const paragraphs = clean
    .split(/\n\s*\n|(?=---\s*עמוד\s+\d+\s*---)/g)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap(splitLongParagraph);

  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (current.length + paragraph.length + 2 <= MAX_CHARS) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }
    chunks.push(current);
    const overlap = current.slice(Math.max(0, current.length - OVERLAP_CHARS));
    current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}

function sourceTexts(file: MongoFile): SourceText[] {
  const summary = nonEmpty(file.processedData?.ocr_metadata?.summary) ?? nonEmpty(file.summary);
  const providedChunks = (file.processedData?.chunks ?? [])
    .filter((chunk) => nonEmpty(chunk.extracted_text))
    .sort((a, b) => (a.chunk_number ?? 0) - (b.chunk_number ?? 0))
    .map((chunk): SourceText => ({
      text: nonEmpty(chunk.extracted_text) ?? '',
      source: 'processedData.chunks',
      pageRange: normalizePageRange(chunk.page_range),
      gcsUri: nonEmpty(chunk.gcs_uri),
      summary,
    }));
  if (providedChunks.length > 0) return providedChunks;

  const combined = nonEmpty(file.processedData?.ocr_metadata?.combined_text);
  if (combined) {
    return [{
      text: combined,
      source: 'processedData.ocr_metadata.combined_text',
      pageRange: null,
      gcsUri: nonEmpty(file.processedData?.gcs_uri) ?? nonEmpty(file.processedData?.file_url),
      summary,
    }];
  }

  const extracted = nonEmpty(file.extractedText);
  if (extracted) {
    return [{
      text: extracted,
      source: 'extractedText',
      pageRange: null,
      gcsUri: nonEmpty(file.processedData?.gcs_uri) ?? nonEmpty(file.processedData?.file_url),
      summary,
    }];
  }

  const rootSummary = nonEmpty(file.summary);
  if (rootSummary) {
    return [{
      text: rootSummary,
      source: 'summary',
      pageRange: null,
      gcsUri: nonEmpty(file.processedData?.gcs_uri) ?? nonEmpty(file.processedData?.file_url),
      summary: rootSummary,
    }];
  }

  return [];
}

export function buildDocumentChunks(file: MongoFile, caseId: string): DocumentChunkNode[] {
  const documentId = extractSourceId(file._id);
  const rows: DocumentChunkNode[] = [];
  for (const source of sourceTexts(file)) {
    for (const text of splitTextIntoChunks(source.text)) {
      const chunkNumber = rows.length + 1;
      rows.push({
        chunkId: `${documentId}:chunk:${chunkNumber}`,
        documentId,
        caseId,
        chunkNumber,
        pageRange: source.pageRange,
        text,
        textPreview: text.slice(0, TEXT_PREVIEW_CHARS),
        summary: source.summary,
        gcsUri: source.gcsUri,
        charCount: text.length,
        source: source.source,
        chunkHash: hashNormalizedText(text),
      });
    }
  }
  return rows;
}

function batches<T>(rows: T[], size = WRITE_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function writeChunkBatch(session: Session, rows: DocumentChunkNode[]): Promise<void> {
  if (rows.length === 0) return;
  await session.run(
    `UNWIND $rows AS row
     MERGE (chunk:DocumentChunk {chunkId: row.chunkId})
     SET chunk.documentId = row.documentId,
         chunk.caseId = row.caseId,
         chunk.chunkNumber = row.chunkNumber,
         chunk.pageRange = row.pageRange,
         chunk.text = row.text,
         chunk.textPreview = row.textPreview,
         chunk.summary = row.summary,
         chunk.gcsUri = row.gcsUri,
         chunk.charCount = row.charCount,
         chunk.source = row.source,
         chunk.chunkHash = row.chunkHash
     WITH row, chunk
     MATCH (doc:Document {sourceId: row.documentId})
     MERGE (doc)-[:HAS_CHUNK]->(chunk)`,
    { rows }
  );
}

async function writeFactBatch(session: Session, rows: EvidenceFactNode[]): Promise<void> {
  if (rows.length === 0) return;
  await session.run(
    `UNWIND $rows AS row
     MERGE (fact:EvidenceFact {factId: row.factId})
     SET fact.caseId = row.caseId,
         fact.documentId = row.documentId,
         fact.chunkId = row.chunkId,
         fact.kind = row.kind,
         fact.subtype = row.subtype,
         fact.label = row.label,
         fact.value = row.value,
         fact.numericValue = row.numericValue,
         fact.unit = row.unit,
         fact.fromDate = row.fromDate,
         fact.toDate = row.toDate,
         fact.observedDate = row.observedDate,
         fact.confidence = row.confidence,
         fact.quote = row.quote,
         fact.metadata = row.metadata,
         fact.source = row.source,
         fact.extractorVersion = row.extractorVersion,
         fact.chunkHash = row.chunkHash
     WITH row, fact
     MATCH (c:Case {caseId: row.caseId})
     MATCH (doc:Document {sourceId: row.documentId})
     MATCH (chunk:DocumentChunk {chunkId: row.chunkId})
     MERGE (c)-[:HAS_EVIDENCE_FACT]->(fact)
     MERGE (doc)-[:SUPPORTS_FACT]->(fact)
     MERGE (chunk)-[:SUPPORTS_FACT]->(fact)`,
    { rows }
  );
}

interface ChunkExtractionTask {
  caseId: string;
  documentId: string;
  chunk: DocumentChunkNode;
  observedDate: string | null;
}

/**
 * Runs an async function over `items` with at most `limit` in flight at once.
 * No external dependency; small enough to inline here so the ingest pipeline
 * stays self-contained.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      results[i] = await fn(item, i);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

function resolvePricePerMtok(modelId: string, env: NodeJS.ProcessEnv = process.env): {
  input: number;
  output: number;
} {
  const inputOverride = Number(env.OCR_LLM_PRICE_INPUT_PER_MTOK);
  const outputOverride = Number(env.OCR_LLM_PRICE_OUTPUT_PER_MTOK);
  const fromTable = MODEL_PRICE_TABLE[modelId] ?? { input: 0, output: 0 };
  return {
    input: Number.isFinite(inputOverride) ? inputOverride : fromTable.input,
    output: Number.isFinite(outputOverride) ? outputOverride : fromTable.output,
  };
}

function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface ProgressTracker {
  record: (stats: LlmCallStats) => void;
  finalSummary: () => void;
  estimatedCostUsd: () => number;
}

function createProgressTracker(total: number, modelId: string): ProgressTracker {
  const startedAt = Date.now();
  const price = resolvePricePerMtok(modelId);
  const progressEvery = Number(process.env.OCR_LLM_PROGRESS_EVERY) || PROGRESS_EVERY_DEFAULT;
  let completed = 0;
  let cachedHits = 0;
  let liveCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let lastPrintAt = 0;

  const estimatedCostUsd = (): number =>
    (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;

  const print = (force = false): void => {
    const now = Date.now();
    if (
      !force &&
      completed % progressEvery !== 0 &&
      now - lastPrintAt < PROGRESS_MIN_INTERVAL_MS
    ) {
      return;
    }
    lastPrintAt = now;
    const elapsedMs = now - startedAt;
    const ratePerSec = completed > 0 ? completed / Math.max(1, elapsedMs / 1000) : 0;
    const remaining = total - completed;
    const etaMs = ratePerSec > 0 ? (remaining / ratePerSec) * 1000 : 0;
    const cost = estimatedCostUsd();
    const pct = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';
    logger.log(
      `  chunks ${completed}/${total} (${pct}%) | elapsed ${formatDurationShort(
        elapsedMs
      )} | rate ${ratePerSec.toFixed(2)}/s | ETA ${formatDurationShort(etaMs)} | live ${liveCalls}` +
        ` cached ${cachedHits} | tokens in ${formatTokens(inputTokens)} out ${formatTokens(
          outputTokens
        )} | est cost $${cost.toFixed(4)}`
    );
  };

  return {
    record: (stats) => {
      completed++;
      if (stats.cached) cachedHits++;
      else liveCalls++;
      inputTokens += stats.inputTokens;
      outputTokens += stats.outputTokens;
      // Always print the first one quickly so the user sees signs of life.
      const isFirstShown = completed === 1 || completed === 5 || completed === 10;
      print(isFirstShown);
    },
    finalSummary: () => {
      const elapsedMs = Date.now() - startedAt;
      const cost = estimatedCostUsd();
      logger.log(
        `LLM OCR phase done: ${completed}/${total} chunks in ${formatDurationShort(elapsedMs)}` +
          ` (${liveCalls} OpenAI calls, ${cachedHits} cache hits) | tokens in ${formatTokens(
            inputTokens
          )} out ${formatTokens(outputTokens)} | est cost ~$${cost.toFixed(4)} for model ${modelId}`
      );
    },
    estimatedCostUsd,
  };
}

export async function writeDocumentContentAndFacts(
  session: Session,
  db: Db,
  fetchLimit: number,
  caseIds: Set<string>
): Promise<void> {
  logger.log('\nWriting DocumentChunk nodes + OCR evidence facts');
  const mongoFiles = await readCollection(db, 'files', MongoFileSchema, {}, { limit: fetchLimit });
  const chunks: DocumentChunkNode[] = [];
  const facts: EvidenceFactNode[] = [];
  const documentIds: string[] = [];
  const llmTasks: ChunkExtractionTask[] = [];
  const llmEnabled = llmOcrFactsEnabled();
  const extractorVersion = resolveExtractorVersion();

  for (const file of mongoFiles) {
    const resolvedCaseId = resolveFileCaseId(file, caseIds);
    if (!resolvedCaseId) continue;
    const documentId = extractSourceId(file._id);
    documentIds.push(documentId);
    const documentChunks = buildDocumentChunks(file, resolvedCaseId);
    chunks.push(...documentChunks);
    const observedDate =
      file.processedData?.document_date ??
      extractISODate(file.uploadedAt) ??
      null;
    for (const chunk of documentChunks) {
      const regexFacts = extractEvidenceFacts({
        caseId: resolvedCaseId,
        documentId,
        chunkId: chunk.chunkId,
        text: chunk.text,
        observedDate,
      }).map((fact): EvidenceFactNode => ({
        ...fact,
        source: 'regex',
        extractorVersion: REGEX_EXTRACTOR_VERSION,
        chunkHash: chunk.chunkHash,
      }));

      if (!llmEnabled) {
        facts.push(...regexFacts);
        continue;
      }

      // Defer LLM calls so we can run them with bounded concurrency once the
      // synchronous regex pass for the whole document set is done.
      facts.push(...regexFacts);
      llmTasks.push({
        caseId: resolvedCaseId,
        documentId,
        chunk,
        observedDate,
      });
    }
  }

  if (llmEnabled && llmTasks.length > 0) {
    const modelId = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
    const concurrency = resolvePositiveInt(
      process.env.OCR_LLM_CONCURRENCY,
      LLM_CONCURRENCY_DEFAULT
    );
    const batchSize = resolvePositiveInt(
      process.env.OCR_LLM_BATCH_SIZE,
      LLM_BATCH_SIZE_DEFAULT
    );
    const taskBatches: ChunkExtractionTask[][] = [];
    for (let i = 0; i < llmTasks.length; i += batchSize) {
      taskBatches.push(llmTasks.slice(i, i + batchSize));
    }

    logger.log(
      `Running LLM OCR enrichment on ${llmTasks.length} chunks ` +
        `(extractor ${extractorVersion}, model ${modelId}, ` +
        `${taskBatches.length} batches × up to ${batchSize} chunks, concurrency ${concurrency})`
    );
    logger.log(
      `Progress prints every ${
        Number(process.env.OCR_LLM_PROGRESS_EVERY) || PROGRESS_EVERY_DEFAULT
      } chunks or ${PROGRESS_MIN_INTERVAL_MS / 1000}s, whichever comes first.`
    );
    const progress = createProgressTracker(llmTasks.length, modelId);
    // Same allocation as `llmTasks` so we can copy results back by index.
    const llmResults: EvidenceFactNode[][] = new Array(llmTasks.length);
    for (let i = 0; i < llmResults.length; i++) llmResults[i] = [];

    await runWithConcurrency(
      taskBatches,
      concurrency,
      async (taskBatch, batchIdx): Promise<void> => {
        // Filter out chunks missing a hash (defensive — buildDocumentChunks always sets one).
        const batchInputs: { input: LlmExtractionInput; globalIndex: number }[] = [];
        for (let local = 0; local < taskBatch.length; local++) {
          const task = taskBatch[local]!;
          const globalIndex = batchIdx * batchSize + local;
          const chunkHash = task.chunk.chunkHash;
          if (!chunkHash) {
            progress.record({
              cached: false,
              durationMs: 0,
              inputTokens: 0,
              outputTokens: 0,
            });
            continue;
          }
          batchInputs.push({
            globalIndex,
            input: {
              caseId: task.caseId,
              documentId: task.documentId,
              chunkId: task.chunk.chunkId,
              chunkHash,
              text: task.chunk.text,
              observedDate: task.observedDate,
            },
          });
        }
        if (batchInputs.length === 0) return;

        try {
          const facts = await extractEvidenceFactsBatchWithLLM(
            batchInputs.map((b) => b.input),
            { extractorVersion, onCallComplete: progress.record }
          );
          for (let k = 0; k < batchInputs.length; k++) {
            const { globalIndex } = batchInputs[k]!;
            llmResults[globalIndex] = facts[k] ?? [];
          }
        } catch (error: unknown) {
          // LLM failure must degrade quality, not break ingestion. We pay
          // the progress event for each chunk in the batch even on failure
          // so the ETA stays honest.
          logger.warn(
            `LLM OCR enrichment failed for batch (${batchInputs.length} chunks); keeping regex baseline. Reason:`,
            error instanceof Error ? error.message : error
          );
          for (let k = 0; k < batchInputs.length; k++) {
            progress.record({
              cached: false,
              durationMs: 0,
              inputTokens: 0,
              outputTokens: 0,
            });
          }
        }
      }
    );
    progress.finalSummary();

    // Merge LLM facts back into the buffer per chunk so dedupe runs against the
    // already-collected regex facts for that exact chunk.
    const factsByChunk = new Map<string, EvidenceFactNode[]>();
    for (const fact of facts) {
      const list = factsByChunk.get(fact.chunkId);
      if (list) list.push(fact);
      else factsByChunk.set(fact.chunkId, [fact]);
    }
    const mergedFacts: EvidenceFactNode[] = [];
    const mergedChunkIds = new Set<string>();
    for (let i = 0; i < llmTasks.length; i++) {
      const task = llmTasks[i]!;
      const llmFacts = llmResults[i] ?? [];
      const chunkRegex = factsByChunk.get(task.chunk.chunkId) ?? [];
      mergedFacts.push(...mergeEvidenceFacts(chunkRegex, llmFacts));
      mergedChunkIds.add(task.chunk.chunkId);
    }
    // Keep regex facts for any chunks that did not run through the LLM (e.g.
    // `llmEnabled=true` but the chunk had no text, so it never landed in
    // `llmTasks`).
    for (const fact of facts) {
      if (!mergedChunkIds.has(fact.chunkId)) mergedFacts.push(fact);
    }
    facts.length = 0;
    facts.push(...mergedFacts);
  }

  for (const ids of batches(documentIds, WRITE_BATCH_SIZE)) {
    await session.run(
      `UNWIND $ids AS documentId
       MATCH (:Document {sourceId: documentId})-[:SUPPORTS_FACT]->(fact:EvidenceFact)
       DETACH DELETE fact`,
      { ids }
    );
    await session.run(
      `UNWIND $ids AS documentId
       MATCH (:Document {sourceId: documentId})-[:HAS_CHUNK]->(chunk:DocumentChunk)
       DETACH DELETE chunk`,
      { ids }
    );
  }
  for (const batch of batches(chunks)) await writeChunkBatch(session, batch);
  for (const batch of batches(facts)) await writeFactBatch(session, batch);

  const llmCount = facts.filter((fact) => fact.source === 'llm').length;
  logger.log(
    `Wrote ${chunks.length} DocumentChunks and ${facts.length} OCR evidence facts` +
      (llmEnabled ? ` (${llmCount} from LLM, ${facts.length - llmCount} from regex)` : '')
  );
}
