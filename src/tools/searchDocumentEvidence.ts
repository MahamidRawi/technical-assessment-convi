import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jNullableString,
  neo4jNumber,
  neo4jString,
} from './_shared/neo4jMap';
import { resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface DocumentEvidenceHit {
  sourceType: 'DocumentChunk' | 'EvidenceFact';
  caseId: string;
  caseName: string;
  documentId: string | null;
  chunkId: string | null;
  factId: string | null;
  fileName: string | null;
  documentCategory: string | null;
  pageRange: string | null;
  gcsUri: string | null;
  score: number;
  snippet: string;
  factKind: string | null;
  factSubtype: string | null;
  factLabel: string | null;
  quote: string | null;
}

export interface DocumentEvidenceSearchResult {
  query: string;
  status: 'ok' | 'insufficient_graph_evidence';
  hits: DocumentEvidenceHit[];
  meta: QueryMeta;
}

const inputSchema = z.object({
  query: z.string().min(1).describe('Free-text Hebrew/English evidence query over OCR chunks and extracted facts.'),
  caseId: z.string().optional().describe('Optional canonical caseId, Mongo _id, or Neo4j Case.sourceId filter.'),
  caseType: z.string().optional(),
  legalStage: z.string().optional(),
  documentCategory: z.string().optional(),
  factKinds: z.array(z.string()).optional().describe('Optional EvidenceFact.kind filters.'),
  limit: z.number().int().min(1).max(30).default(10),
});

const rowSchema = z.object({
  sourceType: z.enum(['DocumentChunk', 'EvidenceFact']),
  caseId: neo4jString,
  caseName: neo4jString,
  documentId: neo4jNullableString,
  chunkId: neo4jNullableString,
  factId: neo4jNullableString,
  fileName: neo4jNullableString,
  documentCategory: neo4jNullableString,
  pageRange: neo4jNullableString,
  gcsUri: neo4jNullableString,
  score: neo4jNumber,
  snippet: neo4jString,
  factKind: neo4jNullableString,
  factSubtype: neo4jNullableString,
  factLabel: neo4jNullableString,
  quote: neo4jNullableString,
});

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildFulltextQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '').trim())
    .filter((term) => term.length > 0);
  return terms.length > 0 ? terms.map((term) => `${term}*`).join(' OR ') : query.trim();
}

async function execute(input: z.infer<typeof inputSchema>): Promise<DocumentEvidenceSearchResult> {
  const caseId = emptyToNull(input.caseId) ? await resolveCaseId(input.caseId ?? '') : null;
  const params = {
    fulltextQuery: buildFulltextQuery(input.query),
    originalQuery: input.query,
    caseId,
    caseType: emptyToNull(input.caseType),
    legalStage: emptyToNull(input.legalStage),
    documentCategory: emptyToNull(input.documentCategory),
    factKinds: input.factKinds?.map((k) => k.trim()).filter(Boolean) ?? [],
    limit: input.limit,
  };
  const cypher = `
    CALL {
      CALL db.index.fulltext.queryNodes('documentChunkFulltext', $fulltextQuery) YIELD node, score
      WITH node AS chunk, score
      MATCH (c:Case {caseId: chunk.caseId})-[:HAS_DOCUMENT]->(doc:Document {sourceId: chunk.documentId})
      OPTIONAL MATCH (doc)-[:OF_CATEGORY]->(dc:DocumentCategory)
      OPTIONAL MATCH (chunk)-[:SUPPORTS_FACT]->(fact:EvidenceFact)
      WITH c, doc, dc, chunk, score, collect(DISTINCT fact) AS facts
      WHERE ($caseId IS NULL OR c.caseId = $caseId)
        AND ($caseType IS NULL OR c.caseType = $caseType)
        AND ($legalStage IS NULL OR c.legalStage = $legalStage)
        AND ($documentCategory IS NULL OR coalesce(dc.name, doc.documentCategory) = $documentCategory)
        AND (size($factKinds) = 0 OR any(f IN facts WHERE f.kind IN $factKinds))
      WITH c, doc, dc, chunk, score,
           head([f IN facts WHERE size($factKinds) = 0 OR f.kind IN $factKinds]) AS fact
      RETURN 'DocumentChunk' AS sourceType,
             c.caseId AS caseId,
             c.caseName AS caseName,
             doc.sourceId AS documentId,
             chunk.chunkId AS chunkId,
             CASE WHEN fact IS NULL THEN null ELSE fact.factId END AS factId,
             doc.fileName AS fileName,
             coalesce(dc.name, doc.documentCategory) AS documentCategory,
             chunk.pageRange AS pageRange,
             chunk.gcsUri AS gcsUri,
             score AS score,
             coalesce(chunk.textPreview, left(chunk.text, 700)) AS snippet,
             CASE WHEN fact IS NULL THEN null ELSE fact.kind END AS factKind,
             CASE WHEN fact IS NULL THEN null ELSE fact.subtype END AS factSubtype,
             CASE WHEN fact IS NULL THEN null ELSE fact.label END AS factLabel,
             CASE WHEN fact IS NULL THEN null ELSE fact.quote END AS quote

      UNION ALL

      CALL db.index.fulltext.queryNodes('evidenceFactFulltext', $fulltextQuery) YIELD node, score
      WITH node AS fact, score
      MATCH (c:Case)-[:HAS_EVIDENCE_FACT]->(fact)
      MATCH (doc:Document)-[:SUPPORTS_FACT]->(fact)
      OPTIONAL MATCH (chunk:DocumentChunk)-[:SUPPORTS_FACT]->(fact)
      OPTIONAL MATCH (doc)-[:OF_CATEGORY]->(dc:DocumentCategory)
      WHERE ($caseId IS NULL OR c.caseId = $caseId)
        AND ($caseType IS NULL OR c.caseType = $caseType)
        AND ($legalStage IS NULL OR c.legalStage = $legalStage)
        AND ($documentCategory IS NULL OR coalesce(dc.name, doc.documentCategory) = $documentCategory)
        AND (size($factKinds) = 0 OR fact.kind IN $factKinds)
      RETURN 'EvidenceFact' AS sourceType,
             c.caseId AS caseId,
             c.caseName AS caseName,
             doc.sourceId AS documentId,
             chunk.chunkId AS chunkId,
             fact.factId AS factId,
             doc.fileName AS fileName,
             coalesce(dc.name, doc.documentCategory) AS documentCategory,
             chunk.pageRange AS pageRange,
             chunk.gcsUri AS gcsUri,
             score AS score,
             fact.quote AS snippet,
             fact.kind AS factKind,
             fact.subtype AS factSubtype,
             fact.label AS factLabel,
             fact.quote AS quote
    }
    RETURN sourceType, caseId, caseName, documentId, chunkId, factId, fileName,
           documentCategory, pageRange, gcsUri, score, left(snippet, 700) AS snippet,
           factKind, factSubtype, factLabel, quote
    ORDER BY score DESC, caseName ASC
    LIMIT toInteger($limit)
  `;
  const { rows, meta } = await runReadQueryWithMeta(cypher, params, rowSchema);
  return {
    query: input.query,
    status: rows.length > 0 ? 'ok' : 'insufficient_graph_evidence',
    hits: rows,
    meta,
  };
}

export const searchDocumentEvidenceTool: ToolDefinition<typeof inputSchema, DocumentEvidenceSearchResult> = {
  name: 'searchDocumentEvidence',
  label: 'Searching OCR evidence',
  inputSchema,
  execute,
  summarize: (result) =>
    result.status === 'ok'
      ? `${result.hits.length} OCR/fact evidence hits`
      : 'No OCR/fact evidence found in the graph',
  extractEvidence: (result) =>
    result.hits.map((hit) => ({
      sourceType: hit.sourceType === 'EvidenceFact' ? 'Document' as const : 'Document' as const,
      sourceId: hit.factId ?? hit.chunkId ?? hit.documentId ?? hit.caseId,
      label: hit.factLabel ?? hit.fileName ?? hit.caseName,
      viaTool: 'searchDocumentEvidence',
    })),
  traceMeta: (result) => result.meta,
};
