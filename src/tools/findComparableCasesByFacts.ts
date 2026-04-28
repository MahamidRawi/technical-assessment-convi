import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jBoolean,
  neo4jNullableNumber,
  neo4jNullableString,
  neo4jNumber,
  neo4jString,
} from './_shared/neo4jMap';
import { resolveCaseId } from './_shared/notFound';
import { normalizeTerm } from '@/pipeline/ingest/normalize';
import type { ToolDefinition } from './types';

export interface ComparableFact {
  factId: string;
  kind: string;
  subtype: string | null;
  label: string;
  value: string | null;
  numericValue: number | null;
  quote: string;
}

export interface ComparableValuation {
  valuationId: string;
  compensationMin: number | null;
  compensationMax: number | null;
  totalEstimate: number | null;
  feeMin: number | null;
  feeMax: number | null;
}

export interface ComparableCaseByFacts {
  caseId: string;
  caseName: string;
  caseType: string;
  legalStage: string;
  clientAge: number | null;
  workAccidentFlag: boolean | null;
  score: number;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
  evidenceFacts: ComparableFact[];
  valuation: ComparableValuation | null;
}

export interface ComparableCasesByFactsResult {
  status: 'ok' | 'insufficient_graph_evidence';
  seedCaseId: string | null;
  hits: ComparableCaseByFacts[];
  meta: QueryMeta;
}

export const comparableCasesInputSchema = z.object({
  caseId: z.string().optional().describe('Optional seed caseId, Mongo _id, or Neo4j Case.sourceId.'),
  caseType: z.string().optional(),
  workAccidentFlag: z.boolean().optional(),
  ageMin: z.number().int().min(0).max(130).optional(),
  ageMax: z.number().int().min(0).max(130).optional(),
  injury: z.string().optional(),
  bodyPart: z.string().optional(),
  disabilityPercentMin: z.number().min(0).max(100).optional(),
  disabilityPercentMax: z.number().min(0).max(100).optional(),
  permanentDisability: z.boolean().optional(),
  legalStage: z.string().optional(),
  limit: z.number().int().min(1).max(30).default(10),
});

type ComparableCasesInput = z.infer<typeof comparableCasesInputSchema>;

const factSchema = z.object({
  factId: neo4jString,
  kind: neo4jString,
  subtype: neo4jNullableString,
  label: neo4jString,
  value: neo4jNullableString,
  numericValue: neo4jNullableNumber,
  quote: neo4jString,
});

const rowSchema = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseType: neo4jString,
  legalStage: neo4jString,
  clientAge: neo4jNullableNumber,
  workAccidentFlag: z.union([neo4jBoolean, z.null()]),
  score: neo4jNumber,
  caseTypeMatched: neo4jBoolean,
  workAccidentMatched: neo4jBoolean,
  ageMatched: neo4jBoolean,
  injuryMatched: neo4jBoolean,
  bodyPartMatched: neo4jBoolean,
  disabilityMatched: neo4jBoolean,
  stageMatched: neo4jBoolean,
  seedSimilarityScore: neo4jNullableNumber,
  evidenceFacts: z.array(factSchema),
  valuationId: neo4jNullableString,
  compensationMin: neo4jNullableNumber,
  compensationMax: neo4jNullableNumber,
  totalEstimate: neo4jNullableNumber,
  feeMin: neo4jNullableNumber,
  feeMax: neo4jNullableNumber,
});

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function positiveNumberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isTrafficAccidentTerm(value: string | null): boolean {
  return Boolean(value && /תאונת דרכים|דרכים|traffic accident|car accident/i.test(value));
}

function isWorkAccidentTerm(value: string | null): boolean {
  return Boolean(value && /תאונת עבודה|עבודה|work accident/i.test(value));
}

export function normalizeComparableFilters(input: ComparableCasesInput): {
  caseType: string | null;
  caseTypes: string[];
  injury: string | null;
  bodyPart: string | null;
} {
  const caseType = emptyToNull(input.caseType);
  const rawInjury = emptyToNull(input.injury);
  const rawBodyPart = emptyToNull(input.bodyPart);
  const caseTypes = new Set<string>();

  if (isTrafficAccidentTerm(rawInjury) || isTrafficAccidentTerm(rawBodyPart)) {
    caseTypes.add('car_accident_serious');
    caseTypes.add('car_accident_minor');
  }
  if (!caseType && (isWorkAccidentTerm(rawInjury) || isWorkAccidentTerm(rawBodyPart))) {
    caseTypes.add('work_accident');
  }

  return {
    caseType,
    caseTypes: Array.from(caseTypes),
    injury: rawInjury && !isTrafficAccidentTerm(rawInjury) && !isWorkAccidentTerm(rawInjury)
      ? normalizeTerm('injury', rawInjury)
      : null,
    bodyPart: rawBodyPart && !isTrafficAccidentTerm(rawBodyPart) && !isWorkAccidentTerm(rawBodyPart)
      ? normalizeTerm('bodyPart', rawBodyPart)
      : null,
  };
}

function confidence(score: number): ComparableCaseByFacts['confidence'] {
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function reasons(row: z.output<typeof rowSchema>): string[] {
  const out: string[] = [];
  if (row.caseTypeMatched) out.push(`case type ${row.caseType}`);
  if (row.workAccidentMatched) out.push('work accident flag matched');
  if (row.ageMatched && row.clientAge !== null) out.push(`age ${row.clientAge} in requested band`);
  if (row.injuryMatched) out.push('injury matched');
  if (row.bodyPartMatched) out.push('body part matched');
  if (row.disabilityMatched) out.push('disability fact matched');
  if (row.stageMatched) out.push(`stage ${row.legalStage}`);
  if (row.seedSimilarityScore !== null) out.push(`existing graph similarity ${row.seedSimilarityScore.toFixed(2)}`);
  if (row.valuationId) out.push('valuation available');
  return out;
}

export async function findComparableCasesByFacts(
  input: ComparableCasesInput
): Promise<ComparableCasesByFactsResult> {
  const seedCaseId = emptyToNull(input.caseId) ? await resolveCaseId(input.caseId ?? '') : null;
  const normalizedFilters = normalizeComparableFilters(input);
  const params = {
    seedCaseId,
    caseType: normalizedFilters.caseType,
    caseTypes: normalizedFilters.caseTypes,
    workAccidentFlag: input.workAccidentFlag === true ? true : null,
    ageMin: positiveNumberOrNull(input.ageMin),
    ageMax: positiveNumberOrNull(input.ageMax),
    injury: normalizedFilters.injury,
    bodyPart: normalizedFilters.bodyPart,
    disabilityPercentMin: positiveNumberOrNull(input.disabilityPercentMin),
    disabilityPercentMax: positiveNumberOrNull(input.disabilityPercentMax),
    permanentDisability: input.permanentDisability === true ? true : null,
    legalStage: emptyToNull(input.legalStage),
    limit: input.limit,
  };
  const cypher = `
    MATCH (c:Case)
    WHERE ($seedCaseId IS NULL OR c.caseId <> $seedCaseId)
      AND ($caseType IS NULL OR c.caseType = $caseType OR c.caseType IN $caseTypes)
      AND ($workAccidentFlag IS NULL OR c.workAccidentFlag = $workAccidentFlag)
      AND ($ageMin IS NULL OR c.clientAge IS NULL OR c.clientAge >= $ageMin)
      AND ($ageMax IS NULL OR c.clientAge IS NULL OR c.clientAge <= $ageMax)
      AND ($legalStage IS NULL OR c.legalStage = $legalStage)
      AND ($injury IS NULL OR EXISTS {
        MATCH (c)-[:HAS_INJURY]->(inj:Injury)
        WHERE coalesce(inj.normalized, toLower(inj.name)) = $injury
      })
      AND ($bodyPart IS NULL OR EXISTS {
        MATCH (c)-[:AFFECTS_BODY_PART]->(bp:BodyPart)
        WHERE coalesce(bp.normalized, toLower(bp.name)) = $bodyPart
      })
      AND (($disabilityPercentMin IS NULL AND $disabilityPercentMax IS NULL AND $permanentDisability IS NULL) OR EXISTS {
        MATCH (c)-[:HAS_EVIDENCE_FACT]->(df:EvidenceFact {kind: 'disability_period'})
        WHERE ($disabilityPercentMin IS NULL OR df.numericValue >= $disabilityPercentMin)
          AND ($disabilityPercentMax IS NULL OR df.numericValue <= $disabilityPercentMax)
          AND ($permanentDisability IS NULL OR df.subtype = 'permanent')
      })
    OPTIONAL MATCH (seed:Case {caseId: $seedCaseId})-[sim:SIMILAR_TO]->(c)
    OPTIONAL MATCH (c)-[:HAS_VALUATION]->(valuation:CaseValuation)
    WITH c, sim, head(collect(valuation)) AS valuation
    OPTIONAL MATCH (c)-[:HAS_EVIDENCE_FACT]->(fact:EvidenceFact)
    WHERE fact.kind IN ['disability_period', 'income_evidence', 'work_accident', 'regulation_15', 'nii_decision', 'medical_committee']
    WITH c, sim, valuation, collect(DISTINCT {
      factId: fact.factId,
      kind: fact.kind,
      subtype: fact.subtype,
      label: fact.label,
      value: fact.value,
      numericValue: fact.numericValue,
      quote: fact.quote
    })[0..8] AS evidenceFacts
    WITH c, sim, valuation, evidenceFacts,
         (($caseType IS NOT NULL AND c.caseType = $caseType) OR c.caseType IN $caseTypes) AS caseTypeMatched,
         ($workAccidentFlag IS NOT NULL AND c.workAccidentFlag = $workAccidentFlag) AS workAccidentMatched,
         (($ageMin IS NOT NULL OR $ageMax IS NOT NULL) AND c.clientAge IS NOT NULL) AS ageMatched,
         ($legalStage IS NOT NULL AND c.legalStage = $legalStage) AS stageMatched,
         ($injury IS NOT NULL AND EXISTS {
           MATCH (c)-[:HAS_INJURY]->(inj:Injury)
           WHERE coalesce(inj.normalized, toLower(inj.name)) = $injury
         }) AS injuryMatched,
         ($bodyPart IS NOT NULL AND EXISTS {
           MATCH (c)-[:AFFECTS_BODY_PART]->(bp:BodyPart)
           WHERE coalesce(bp.normalized, toLower(bp.name)) = $bodyPart
         }) AS bodyPartMatched,
         (($disabilityPercentMin IS NOT NULL OR $disabilityPercentMax IS NOT NULL OR $permanentDisability IS NOT NULL) AND EXISTS {
           MATCH (c)-[:HAS_EVIDENCE_FACT]->(df:EvidenceFact {kind: 'disability_period'})
           WHERE ($disabilityPercentMin IS NULL OR df.numericValue >= $disabilityPercentMin)
             AND ($disabilityPercentMax IS NULL OR df.numericValue <= $disabilityPercentMax)
             AND ($permanentDisability IS NULL OR df.subtype = 'permanent')
         }) AS disabilityMatched
    WITH c, sim, valuation, evidenceFacts, caseTypeMatched, workAccidentMatched, ageMatched,
         stageMatched, injuryMatched, bodyPartMatched, disabilityMatched,
         (CASE WHEN caseTypeMatched THEN 2.0 ELSE 0.0 END) +
         (CASE WHEN workAccidentMatched THEN 2.0 ELSE 0.0 END) +
         (CASE WHEN ageMatched THEN 1.0 ELSE 0.0 END) +
         (CASE WHEN injuryMatched THEN 1.5 ELSE 0.0 END) +
         (CASE WHEN bodyPartMatched THEN 1.0 ELSE 0.0 END) +
         (CASE WHEN disabilityMatched THEN 2.0 ELSE 0.0 END) +
         (CASE WHEN stageMatched THEN 0.75 ELSE 0.0 END) +
         coalesce(sim.score, 0.0) +
         (CASE WHEN valuation IS NULL THEN 0.0 ELSE 0.5 END) AS score
    RETURN c.caseId AS caseId,
           c.caseName AS caseName,
           c.caseType AS caseType,
           c.legalStage AS legalStage,
           c.clientAge AS clientAge,
           c.workAccidentFlag AS workAccidentFlag,
           score AS score,
           caseTypeMatched,
           workAccidentMatched,
           ageMatched,
           injuryMatched,
           bodyPartMatched,
           disabilityMatched,
           stageMatched,
           sim.score AS seedSimilarityScore,
           [f IN evidenceFacts WHERE f.factId IS NOT NULL] AS evidenceFacts,
           CASE WHEN valuation IS NULL THEN null ELSE valuation.valuationId END AS valuationId,
           CASE WHEN valuation IS NULL THEN null ELSE valuation.compensationMin END AS compensationMin,
           CASE WHEN valuation IS NULL THEN null ELSE valuation.compensationMax END AS compensationMax,
           CASE WHEN valuation IS NULL THEN null ELSE valuation.totalEstimate END AS totalEstimate,
           CASE WHEN valuation IS NULL THEN null ELSE valuation.feeMin END AS feeMin,
           CASE WHEN valuation IS NULL THEN null ELSE valuation.feeMax END AS feeMax
    ORDER BY score DESC, c.caseName ASC
    LIMIT toInteger($limit)
  `;
  const { rows, meta } = await runReadQueryWithMeta(cypher, params, rowSchema);
  const hits = rows.map((row): ComparableCaseByFacts => ({
    caseId: row.caseId,
    caseName: row.caseName,
    caseType: row.caseType,
    legalStage: row.legalStage,
    clientAge: row.clientAge,
    workAccidentFlag: row.workAccidentFlag,
    score: row.score,
    confidence: confidence(row.score),
    reasons: reasons(row),
    evidenceFacts: row.evidenceFacts,
    valuation: row.valuationId
      ? {
          valuationId: row.valuationId,
          compensationMin: row.compensationMin,
          compensationMax: row.compensationMax,
          totalEstimate: row.totalEstimate,
          feeMin: row.feeMin,
          feeMax: row.feeMax,
        }
      : null,
  }));
  return {
    status: hits.length > 0 ? 'ok' : 'insufficient_graph_evidence',
    seedCaseId,
    hits,
    meta,
  };
}

export const findComparableCasesByFactsTool: ToolDefinition<
  typeof comparableCasesInputSchema,
  ComparableCasesByFactsResult
> = {
  name: 'findComparableCasesByFacts',
  label: 'Finding comparable cases from facts',
  inputSchema: comparableCasesInputSchema,
  execute: findComparableCasesByFacts,
  summarize: (result) =>
    result.status === 'ok'
      ? `${result.hits.length} comparable cases, top confidence ${result.hits[0]?.confidence ?? 'low'}`
      : 'No graph-backed comparable cases found',
  extractEvidence: (result) =>
    result.hits.map((hit) => ({
      sourceType: 'Case' as const,
      sourceId: hit.caseId,
      label: hit.caseName,
      viaTool: 'findComparableCasesByFacts',
    })),
  traceMeta: (result) => result.meta,
};
