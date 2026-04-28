import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jNullableNumber,
  neo4jNullableString,
  neo4jNumber,
  neo4jString,
} from './_shared/neo4jMap';
import { resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface CaseDocumentFact {
  factId: string;
  kind: string;
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
  documentId: string;
  chunkId: string;
  fileName: string | null;
  documentCategory: string | null;
  pageRange: string | null;
  gcsUri: string | null;
}

export interface CaseDocumentFactsResult {
  caseId: string;
  status: 'ok' | 'insufficient_graph_evidence';
  byKind: Array<{ kind: string; count: number }>;
  facts: CaseDocumentFact[];
  meta: QueryMeta;
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
  factKinds: z.array(z.string()).optional(),
  documentCategory: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(40),
});

const rowSchema = z.object({
  factId: neo4jString,
  kind: neo4jString,
  subtype: neo4jNullableString,
  label: neo4jString,
  value: neo4jNullableString,
  numericValue: neo4jNullableNumber,
  unit: neo4jNullableString,
  fromDate: neo4jNullableString,
  toDate: neo4jNullableString,
  observedDate: neo4jNullableString,
  confidence: neo4jNumber,
  quote: neo4jString,
  documentId: neo4jString,
  chunkId: neo4jString,
  fileName: neo4jNullableString,
  documentCategory: neo4jNullableString,
  pageRange: neo4jNullableString,
  gcsUri: neo4jNullableString,
});

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function execute(input: z.infer<typeof inputSchema>): Promise<CaseDocumentFactsResult> {
  const caseId = await resolveCaseId(input.caseId);
  const params = {
    caseId,
    factKinds: input.factKinds?.map((k) => k.trim()).filter(Boolean) ?? [],
    documentCategory: emptyToNull(input.documentCategory),
    limit: input.limit,
  };
  const cypher = `
    MATCH (c:Case {caseId: $caseId})-[:HAS_EVIDENCE_FACT]->(fact:EvidenceFact)
    MATCH (doc:Document)-[:SUPPORTS_FACT]->(fact)
    MATCH (chunk:DocumentChunk)-[:SUPPORTS_FACT]->(fact)
    OPTIONAL MATCH (doc)-[:OF_CATEGORY]->(dc:DocumentCategory)
    WHERE (size($factKinds) = 0 OR fact.kind IN $factKinds)
      AND ($documentCategory IS NULL OR coalesce(dc.name, doc.documentCategory) = $documentCategory)
    RETURN fact.factId AS factId,
           fact.kind AS kind,
           fact.subtype AS subtype,
           fact.label AS label,
           fact.value AS value,
           fact.numericValue AS numericValue,
           fact.unit AS unit,
           fact.fromDate AS fromDate,
           fact.toDate AS toDate,
           fact.observedDate AS observedDate,
           fact.confidence AS confidence,
           fact.quote AS quote,
           doc.sourceId AS documentId,
           chunk.chunkId AS chunkId,
           doc.fileName AS fileName,
           coalesce(dc.name, doc.documentCategory) AS documentCategory,
           chunk.pageRange AS pageRange,
           chunk.gcsUri AS gcsUri
    ORDER BY fact.kind ASC, fact.confidence DESC, fact.observedDate DESC
    LIMIT toInteger($limit)
  `;
  const { rows, meta } = await runReadQueryWithMeta(cypher, params, rowSchema);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  return {
    caseId,
    status: rows.length > 0 ? 'ok' : 'insufficient_graph_evidence',
    byKind: Array.from(counts.entries()).map(([kind, count]) => ({ kind, count })),
    facts: rows,
    meta,
  };
}

export const getCaseDocumentFactsTool: ToolDefinition<typeof inputSchema, CaseDocumentFactsResult> = {
  name: 'getCaseDocumentFacts',
  label: 'Fetching OCR-derived facts',
  inputSchema,
  execute,
  summarize: (result) =>
    result.status === 'ok'
      ? `${result.facts.length} OCR-derived facts across ${result.byKind.length} kinds`
      : 'No OCR-derived facts found for this case',
  extractEvidence: (result) =>
    result.facts.map((fact) => ({
      sourceType: 'Document' as const,
      sourceId: fact.factId,
      label: fact.label,
      viaTool: 'getCaseDocumentFacts',
    })),
  traceMeta: (result) => result.meta,
};
