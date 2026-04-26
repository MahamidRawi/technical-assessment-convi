import { z } from 'zod';
import { runReadQuery } from './_shared/runReadQuery';
import {
  neo4jNodePropsOf,
  neo4jOptionalBoolean,
  neo4jOptionalDateTimeString,
  neo4jOptionalString,
  neo4jOptionalStringArray,
  neo4jString,
} from './_shared/neo4jMap';
import { resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface DocumentRow {
  sourceId: string;
  fileName: string;
  documentCategory: string;
  documentType: string;
  hasOcr: boolean;
  documentDate: string | null;
  provenanceSourceIds: string[];
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
  category: z
    .string()
    .optional()
    .describe('Optional DocumentCategory filter. Omit for all categories; empty string is treated as omitted.'),
  limit: z.number().int().min(1).max(50).default(20),
});

type Input = z.infer<typeof inputSchema>;

const documentPropsSchema = z.object({
  sourceId: neo4jString,
  fileName: neo4jString,
  documentCategory: neo4jOptionalString,
  documentType: neo4jOptionalString,
  hasOcr: neo4jOptionalBoolean,
  documentDate: neo4jOptionalDateTimeString,
});

const rowSchema = z.object({
  d: neo4jNodePropsOf(documentPropsSchema),
  category: neo4jOptionalString,
  documentType: neo4jOptionalString,
  provenanceSourceIds: neo4jOptionalStringArray,
});

async function execute({ caseId, category, limit }: Input): Promise<DocumentRow[]> {
  const canonicalCaseId = await resolveCaseId(caseId);
  const categoryFilter = category?.trim() ? category.trim() : null;
  const cypher = `
    MATCH (c:Case {caseId: $caseId})-[:HAS_DOCUMENT]->(d:Document)
    OPTIONAL MATCH (d)-[:OF_CATEGORY]->(dc:DocumentCategory)
    OPTIONAL MATCH (d)-[:OF_TYPE]->(dt:DocumentType)
    OPTIONAL MATCH (d)-[:DERIVED_FROM]->(origin:Document)
    WITH d,
         coalesce(dc.name, d.documentCategory) AS category,
         coalesce(dt.name, d.documentType) AS documentType,
         [sourceId IN collect(DISTINCT origin.sourceId) WHERE sourceId IS NOT NULL] AS provenanceSourceIds
    WHERE $category IS NULL OR category = $category
    RETURN d, category, documentType, provenanceSourceIds
    ORDER BY d.documentDate DESC, d.uploadedAt DESC
    LIMIT toInteger($limit)
  `;
  const rows = await runReadQuery(
    cypher,
    {
      caseId: canonicalCaseId,
      category: categoryFilter,
      limit,
    },
    rowSchema
  );

  return rows.map((row) => ({
    sourceId: row.d.sourceId,
    fileName: row.d.fileName,
    documentCategory: row.category ?? row.d.documentCategory ?? '',
    documentType: row.documentType ?? row.d.documentType ?? '',
    hasOcr: row.d.hasOcr === true,
    documentDate: row.d.documentDate,
    provenanceSourceIds: row.provenanceSourceIds,
  }));
}

export const getCaseDocumentsTool: ToolDefinition<typeof inputSchema, DocumentRow[]> = {
  name: 'getCaseDocuments',
  label: 'Fetching case documents',
  inputSchema,
  execute,
  summarize: (r) =>
    `${r.length} documents${r.some((doc) => doc.provenanceSourceIds.length > 0) ? ', provenance linked' : ''}`,
  extractEvidence: (r) =>
    r.map((d) => ({
      sourceType: 'Document' as const,
      sourceId: d.sourceId,
      label: d.fileName,
      viaTool: 'getCaseDocuments',
    })),
};
