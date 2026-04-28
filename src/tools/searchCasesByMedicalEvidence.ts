import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jBoolean,
  neo4jNullableString,
  neo4jNumber,
  neo4jString,
  neo4jStringArray,
} from './_shared/neo4jMap';
import type { ToolDefinition } from './types';
import { normalizeText } from '@/pipeline/ingest/normalize';

const NEUROLOGICAL_TERMS = [
  'נוירולוג',
  'נוירולוגי',
  'נוירוכירורג',
  'עצב',
  'עצבי',
  'עצבים',
  'רדיקול',
  'רדיקולופתיה',
  'נימול',
  'רדימות',
  'חוסר תחושה',
  'שינויי תחושה',
  'תחושה',
  'חולשה',
  'הקרנה',
  'emg',
];

const SPINE_TERMS = [
  'עמוד שדרה',
  'שדרה',
  'תעלת השדרה',
  'גב',
  'צוואר',
  'צואר',
  'מותני',
  'צווארי',
  'צוארי',
  'דיסק',
  'חוליה',
  'חוליות',
  'c5',
  'c6',
  'c7',
  'l4',
  'l5',
  's1',
];

export interface MedicalEvidenceSnippet {
  documentId: string;
  fileName: string | null;
  documentCategory: string | null;
  chunkId: string;
  pageRange: string | null;
  snippet: string;
  neurologicalHit: boolean;
  spineHit: boolean;
}

export interface MedicalEvidenceCaseHit {
  caseId: string;
  caseName: string;
  caseType: string;
  legalStage: string;
  mainInjury: string | null;
  score: number;
  neurologicalSignalCount: number;
  spineSignalCount: number;
  matchedNeurologicalInjuries: string[];
  matchedSpineInjuries: string[];
  matchedSpineBodyParts: string[];
  evidence: MedicalEvidenceSnippet[];
}

export interface MedicalEvidenceCaseSearchResult {
  query: string;
  status: 'ok' | 'insufficient_graph_evidence';
  hits: MedicalEvidenceCaseHit[];
  meta: QueryMeta;
}

const inputSchema = z.object({
  query: z.string().min(1).describe('Free-text medical concept query in Hebrew or English.'),
  requireNeurological: z.boolean().default(false),
  requireSpine: z.boolean().default(false),
  caseType: z.string().optional(),
  legalStage: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

const snippetSchema = z.object({
  documentId: neo4jString,
  fileName: neo4jNullableString,
  documentCategory: neo4jNullableString,
  chunkId: neo4jString,
  pageRange: neo4jNullableString,
  snippet: neo4jString,
  neurologicalHit: neo4jBoolean,
  spineHit: neo4jBoolean,
});

const rowSchema = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseType: neo4jString,
  legalStage: neo4jString,
  mainInjury: neo4jNullableString,
  score: neo4jNumber,
  neurologicalSignalCount: neo4jNumber,
  spineSignalCount: neo4jNumber,
  matchedNeurologicalInjuries: neo4jStringArray,
  matchedSpineInjuries: neo4jStringArray,
  matchedSpineBodyParts: neo4jStringArray,
  evidence: z.array(snippetSchema),
});

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function uniqueTerms(terms: string[]): string[] {
  return Array.from(new Set(
    terms.flatMap((term) => {
      const raw = term.trim().toLowerCase();
      const normalized = normalizeText(term);
      return [raw, normalized].filter(Boolean);
    })
  ));
}

function queryTerms(query: string): string[] {
  const normalized = normalizeText(query);
  const rawTerms = normalized.split(/\s+/).filter((term) => term.length >= 2);
  const hasNeurologicalIntent = /נוירולוג|עצב|עצבי|תחושה|נימול|רדימות|הקרנה|emg/i.test(query);
  const hasSpineIntent = /עמוד|שדרה|גב|צוואר|צואר|דיסק|חוליה|מותני|צווארי|צוארי/i.test(query);
  return uniqueTerms([
    ...rawTerms,
    ...(hasNeurologicalIntent ? NEUROLOGICAL_TERMS : []),
    ...(hasSpineIntent ? SPINE_TERMS : []),
  ]);
}

function fulltextQuery(terms: string[]): string {
  return terms
    .map((term) => term.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '').trim())
    .filter(Boolean)
    .map((term) => `${term}*`)
    .join(' OR ');
}

async function execute(
  input: z.infer<typeof inputSchema>
): Promise<MedicalEvidenceCaseSearchResult> {
  const neuroTerms = uniqueTerms(NEUROLOGICAL_TERMS);
  const spineTerms = uniqueTerms(SPINE_TERMS);
  const allTerms = uniqueTerms([...queryTerms(input.query), ...neuroTerms, ...spineTerms]);
  const params = {
    fulltextQuery: fulltextQuery(allTerms),
    allTerms,
    neuroTerms,
    spineTerms,
    requireNeurological: input.requireNeurological === true,
    requireSpine: input.requireSpine === true,
    caseType: emptyToNull(input.caseType),
    legalStage: emptyToNull(input.legalStage),
    limit: input.limit,
  };
  const cypher = `
    CALL {
      MATCH (c:Case)
      WHERE any(term IN $allTerms WHERE toLower(coalesce(c.mainInjury, '')) CONTAINS term)
      RETURN c.caseId AS caseId

      UNION

      MATCH (c:Case)-[:HAS_INJURY]->(inj:Injury)
      WHERE any(term IN $allTerms WHERE toLower(inj.name) CONTAINS term OR coalesce(inj.normalized, '') CONTAINS term)
      RETURN c.caseId AS caseId

      UNION

      MATCH (c:Case)-[:AFFECTS_BODY_PART]->(bp:BodyPart)
      WHERE any(term IN $allTerms WHERE toLower(bp.name) CONTAINS term OR coalesce(bp.normalized, '') CONTAINS term)
      RETURN c.caseId AS caseId

      UNION

      CALL db.index.fulltext.queryNodes('documentChunkFulltext', $fulltextQuery, {limit: 500}) YIELD node
      RETURN node.caseId AS caseId
    }
    WITH DISTINCT caseId
    MATCH (c:Case {caseId: caseId})
    WHERE ($caseType IS NULL OR c.caseType = $caseType)
      AND ($legalStage IS NULL OR c.legalStage = $legalStage)
    WITH c,
      [(c)-[:HAS_INJURY]->(ni:Injury)
        WHERE any(term IN $neuroTerms WHERE toLower(ni.name) CONTAINS term OR coalesce(ni.normalized, '') CONTAINS term)
        | ni.name] AS matchedNeurologicalInjuries,
      [(c)-[:HAS_INJURY]->(si:Injury)
        WHERE any(term IN $spineTerms WHERE toLower(si.name) CONTAINS term OR coalesce(si.normalized, '') CONTAINS term)
        | si.name] AS matchedSpineInjuries,
      [(c)-[:AFFECTS_BODY_PART]->(bp:BodyPart)
        WHERE any(term IN $spineTerms WHERE toLower(bp.name) CONTAINS term OR coalesce(bp.normalized, '') CONTAINS term)
        | bp.name] AS matchedSpineBodyParts
    CALL {
      WITH c
      MATCH (c)-[:HAS_DOCUMENT]->(doc:Document)-[:HAS_CHUNK]->(chunk:DocumentChunk)
      WITH doc, chunk,
        toLower(coalesce(chunk.text, '') + ' ' + coalesce(chunk.textPreview, '') + ' ' + coalesce(chunk.summary, '')) AS haystack
      WHERE any(term IN $allTerms WHERE haystack CONTAINS term)
      WITH doc, chunk,
        any(term IN $neuroTerms WHERE haystack CONTAINS term) AS neurologicalHit,
        any(term IN $spineTerms WHERE haystack CONTAINS term) AS spineHit
      WITH doc, chunk, neurologicalHit, spineHit
      ORDER BY CASE WHEN neurologicalHit AND spineHit THEN 3 WHEN neurologicalHit THEN 2 WHEN spineHit THEN 1 ELSE 0 END DESC,
               chunk.charCount DESC
      RETURN collect({
        documentId: doc.sourceId,
        fileName: doc.fileName,
        documentCategory: doc.documentCategory,
        chunkId: chunk.chunkId,
        pageRange: chunk.pageRange,
        snippet: left(coalesce(chunk.textPreview, chunk.text), 700),
        neurologicalHit: neurologicalHit,
        spineHit: spineHit
      })[0..5] AS evidence,
      sum(CASE WHEN neurologicalHit THEN 1 ELSE 0 END) AS neurologicalChunkCount,
      sum(CASE WHEN spineHit THEN 1 ELSE 0 END) AS spineChunkCount,
      sum(CASE WHEN neurologicalHit AND spineHit THEN 1 ELSE 0 END) AS combinedChunkCount
    }
    WITH c,
      matchedNeurologicalInjuries,
      matchedSpineInjuries,
      matchedSpineBodyParts,
      evidence,
      size(matchedNeurologicalInjuries) + neurologicalChunkCount AS neurologicalSignalCount,
      size(matchedSpineInjuries) + size(matchedSpineBodyParts) + spineChunkCount AS spineSignalCount,
      neurologicalChunkCount,
      spineChunkCount,
      combinedChunkCount
    WHERE ($requireNeurological = false OR neurologicalSignalCount > 0)
      AND ($requireSpine = false OR spineSignalCount > 0)
    WITH c,
      matchedNeurologicalInjuries,
      matchedSpineInjuries,
      matchedSpineBodyParts,
      evidence,
      neurologicalSignalCount,
      spineSignalCount,
      combinedChunkCount,
      CASE WHEN neurologicalChunkCount > 5 THEN 5 ELSE neurologicalChunkCount END AS cappedNeurologicalChunks,
      CASE WHEN spineChunkCount > 5 THEN 5 ELSE spineChunkCount END AS cappedSpineChunks,
      CASE WHEN combinedChunkCount > 5 THEN 5 ELSE combinedChunkCount END AS cappedCombinedChunks
    WITH c,
      matchedNeurologicalInjuries,
      matchedSpineInjuries,
      matchedSpineBodyParts,
      evidence,
      neurologicalSignalCount,
      spineSignalCount,
      combinedChunkCount,
      size(matchedNeurologicalInjuries) * 8.0 +
      size(matchedSpineInjuries) * 8.0 +
      size(matchedSpineBodyParts) * 4.0 +
      cappedCombinedChunks * 3.0 +
      cappedNeurologicalChunks +
      cappedSpineChunks AS score
    RETURN c.caseId AS caseId,
      c.caseName AS caseName,
      c.caseType AS caseType,
      c.legalStage AS legalStage,
      c.mainInjury AS mainInjury,
      score AS score,
      neurologicalSignalCount AS neurologicalSignalCount,
      spineSignalCount AS spineSignalCount,
      matchedNeurologicalInjuries AS matchedNeurologicalInjuries,
      matchedSpineInjuries AS matchedSpineInjuries,
      matchedSpineBodyParts AS matchedSpineBodyParts,
      evidence AS evidence
    ORDER BY score DESC, c.caseName ASC
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

export const searchCasesByMedicalEvidenceTool: ToolDefinition<
  typeof inputSchema,
  MedicalEvidenceCaseSearchResult
> = {
  name: 'searchCasesByMedicalEvidence',
  label: 'Searching cases by medical evidence',
  inputSchema,
  execute,
  summarize: (result) =>
    result.status === 'ok'
      ? `${result.hits.length} cases with medical evidence signals`
      : 'No cases with matching medical evidence signals',
  extractEvidence: (result) =>
    result.hits.map((hit) => ({
      sourceType: 'Case' as const,
      sourceId: hit.caseId,
      label: hit.caseName,
      viaTool: 'searchCasesByMedicalEvidence',
    })),
  traceMeta: (result) => result.meta,
};
