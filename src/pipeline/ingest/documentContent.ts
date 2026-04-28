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

const logger = createLogger('Ingest');
const TARGET_CHARS = 2200;
const MAX_CHARS = 2600;
const OVERLAP_CHARS = 180;
const TEXT_PREVIEW_CHARS = 700;
const WRITE_BATCH_SIZE = 400;

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
         chunk.source = row.source
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
         fact.metadata = row.metadata
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
      facts.push(
        ...extractEvidenceFacts({
          caseId: resolvedCaseId,
          documentId,
          chunkId: chunk.chunkId,
          text: chunk.text,
          observedDate,
        })
      );
    }
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

  logger.log(`Wrote ${chunks.length} DocumentChunks and ${facts.length} OCR evidence facts`);
}
