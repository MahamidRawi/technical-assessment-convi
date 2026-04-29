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
import { coerceVocabOrNull, dynamicEnumOptional } from './_shared/dynamicEnums';
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

export interface FilterDiagnostic {
  appliedFilters: Record<string, string | number | boolean>;
  unfilteredCount: number;
  hint: string;
}

export interface ComparableCasesByFactsResult {
  status: 'ok' | 'insufficient_graph_evidence' | 'filter_too_restrictive';
  seedCaseId: string | null;
  hits: ComparableCaseByFacts[];
  diagnostic?: FilterDiagnostic;
  meta: QueryMeta;
}

/**
 * Factory rather than a const because `caseType` and `legalStage` source their valid
 * values from the live graph at boot — `loadEnumVocabulary()` populates the cache before
 * the first call. See `_shared/dynamicEnums.ts`.
 */
function createComparableCasesInputSchema() {
  return z.object({
    caseId: z
      .string()
      .optional()
      .describe('Optional seed caseId, Mongo _id, or Neo4j Case.sourceId.'),
    caseType: dynamicEnumOptional(
      'caseType',
      'Optional filter on c.caseType. OMIT unless the user asks about a specific type.'
    ),
    workAccidentFlag: z.boolean().optional(),
    ageMin: z.number().int().min(0).max(130).optional(),
    ageMax: z.number().int().min(0).max(130).optional(),
    injury: z.string().optional(),
    bodyPart: z.string().optional(),
    disabilityPercentMin: z.number().min(0).max(100).optional(),
    disabilityPercentMax: z.number().min(0).max(100).optional(),
    permanentDisability: z.boolean().optional(),
    legalStage: dynamicEnumOptional(
      'legalStage',
      'Optional filter on c.legalStage. OMIT unless the user asks about a specific stage.'
    ),
    limit: z.number().int().min(1).max(30).default(10),
  });
}

export function buildComparableCasesInputSchema(): ReturnType<typeof createComparableCasesInputSchema> {
  return createComparableCasesInputSchema();
}

export type ComparableCasesInputSchema = ReturnType<typeof buildComparableCasesInputSchema>;
type ComparableCasesInput = z.infer<ComparableCasesInputSchema>;

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

export function lowerBoundOrNull(
  value: number | undefined,
  neutralFloor: number
): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > neutralFloor
    ? value
    : null;
}

export function upperBoundOrNull(
  value: number | undefined,
  neutralCeiling: number
): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value < neutralCeiling
    ? value
    : null;
}

export function booleanOrNull(value: boolean | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * LLM default-stuffing defense: drop boolean filters whose `false` value almost always
 * indicates "I needed to fill the schema", not a deliberate user filter. Mirrors the
 * pattern in `searchCases/params.ts`. Use this for `workAccidentFlag` and
 * `permanentDisability`, where `false` is the population default and only `true` is a
 * meaningful narrow-down. Use `booleanOrNull` only when both polarities are deliberate.
 */
export function trueOrNull(value: boolean | undefined): boolean | null {
  return value === true ? true : null;
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
  const caseType = coerceVocabOrNull('caseType', emptyToNull(input.caseType));
  const rawInjury = emptyToNull(input.injury);
  const rawBodyPart = emptyToNull(input.bodyPart);
  const caseTypes = new Set<string>();

  if (!caseType && (isTrafficAccidentTerm(rawInjury) || isTrafficAccidentTerm(rawBodyPart))) {
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
    workAccidentFlag: trueOrNull(input.workAccidentFlag),
    ageMin: lowerBoundOrNull(input.ageMin, 0),
    ageMax: upperBoundOrNull(input.ageMax, 130),
    injury: normalizedFilters.injury,
    bodyPart: normalizedFilters.bodyPart,
    disabilityPercentMin: lowerBoundOrNull(input.disabilityPercentMin, 0),
    disabilityPercentMax: upperBoundOrNull(input.disabilityPercentMax, 100),
    permanentDisability: trueOrNull(input.permanentDisability),
    legalStage: coerceVocabOrNull('legalStage', emptyToNull(input.legalStage)),
    seedAgeTolerance: 10,
    limit: input.limit,
  };
  const cypher = `
    MATCH (c:Case)
    WHERE ($seedCaseId IS NULL OR c.caseId <> $seedCaseId)
      AND ($caseType IS NULL OR c.caseType = $caseType)
      AND (size($caseTypes) = 0 OR c.caseType IN $caseTypes)
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
          AND ($permanentDisability IS NULL
               OR ($permanentDisability = true AND df.subtype = 'permanent')
               OR ($permanentDisability = false AND coalesce(df.subtype, '') <> 'permanent'))
      })
    OPTIONAL MATCH (seed:Case {caseId: $seedCaseId})
    OPTIONAL MATCH (seed)-[sim:SIMILAR_TO]->(c)
    OPTIONAL MATCH (c)-[:HAS_VALUATION]->(valuation:CaseValuation)
    WITH c, seed, sim, head(collect(valuation)) AS valuation
    OPTIONAL MATCH (c)-[:HAS_EVIDENCE_FACT]->(fact:EvidenceFact)
    WHERE fact.kind IN ['disability_period', 'income_evidence', 'work_accident', 'regulation_15', 'nii_decision', 'medical_committee']
    WITH c, seed, sim, valuation, collect(DISTINCT {
      factId: fact.factId,
      kind: fact.kind,
      subtype: fact.subtype,
      label: fact.label,
      value: fact.value,
      numericValue: fact.numericValue,
      quote: fact.quote
    })[0..8] AS evidenceFacts
    WITH c, seed, sim, valuation, evidenceFacts,
         coalesce((($caseType IS NOT NULL AND c.caseType = $caseType)
          OR c.caseType IN $caseTypes
          OR ($seedCaseId IS NOT NULL AND seed IS NOT NULL AND c.caseType = seed.caseType)), false) AS caseTypeMatched,
         coalesce((($workAccidentFlag IS NOT NULL AND c.workAccidentFlag = $workAccidentFlag)
          OR ($workAccidentFlag IS NULL AND seed IS NOT NULL AND seed.workAccidentFlag IS NOT NULL
              AND c.workAccidentFlag = seed.workAccidentFlag)), false) AS workAccidentMatched,
         coalesce(((($ageMin IS NOT NULL OR $ageMax IS NOT NULL) AND c.clientAge IS NOT NULL)
          OR ($ageMin IS NULL AND $ageMax IS NULL AND seed IS NOT NULL
              AND seed.clientAge IS NOT NULL AND c.clientAge IS NOT NULL
              AND abs(c.clientAge - seed.clientAge) <= $seedAgeTolerance)), false) AS ageMatched,
         coalesce((($legalStage IS NOT NULL AND c.legalStage = $legalStage)
          OR ($legalStage IS NULL AND seed IS NOT NULL AND c.legalStage = seed.legalStage)), false) AS stageMatched,
         coalesce((($injury IS NOT NULL AND EXISTS {
           MATCH (c)-[:HAS_INJURY]->(inj:Injury)
           WHERE coalesce(inj.normalized, toLower(inj.name)) = $injury
         })
          OR ($injury IS NULL AND seed IS NOT NULL AND EXISTS {
            MATCH (seed)-[:HAS_INJURY]->(seedInjury:Injury)
            MATCH (c)-[:HAS_INJURY]->(candidateInjury:Injury)
            WHERE coalesce(seedInjury.normalized, toLower(seedInjury.name)) =
                  coalesce(candidateInjury.normalized, toLower(candidateInjury.name))
          })), false) AS injuryMatched,
         coalesce((($bodyPart IS NOT NULL AND EXISTS {
           MATCH (c)-[:AFFECTS_BODY_PART]->(bp:BodyPart)
           WHERE coalesce(bp.normalized, toLower(bp.name)) = $bodyPart
         })
          OR ($bodyPart IS NULL AND seed IS NOT NULL AND EXISTS {
            MATCH (seed)-[:AFFECTS_BODY_PART]->(seedBodyPart:BodyPart)
            MATCH (c)-[:AFFECTS_BODY_PART]->(candidateBodyPart:BodyPart)
            WHERE coalesce(seedBodyPart.normalized, toLower(seedBodyPart.name)) =
                  coalesce(candidateBodyPart.normalized, toLower(candidateBodyPart.name))
          })), false) AS bodyPartMatched,
         coalesce(((($disabilityPercentMin IS NOT NULL OR $disabilityPercentMax IS NOT NULL OR $permanentDisability IS NOT NULL) AND EXISTS {
           MATCH (c)-[:HAS_EVIDENCE_FACT]->(df:EvidenceFact {kind: 'disability_period'})
           WHERE ($disabilityPercentMin IS NULL OR df.numericValue >= $disabilityPercentMin)
             AND ($disabilityPercentMax IS NULL OR df.numericValue <= $disabilityPercentMax)
             AND ($permanentDisability IS NULL
                  OR ($permanentDisability = true AND df.subtype = 'permanent')
                  OR ($permanentDisability = false AND coalesce(df.subtype, '') <> 'permanent'))
         })
          OR ($disabilityPercentMin IS NULL AND $disabilityPercentMax IS NULL
              AND $permanentDisability IS NULL AND seed IS NOT NULL AND EXISTS {
            MATCH (seed)-[:HAS_EVIDENCE_FACT]->(seedDf:EvidenceFact {kind: 'disability_period'})
            MATCH (c)-[:HAS_EVIDENCE_FACT]->(candidateDf:EvidenceFact {kind: 'disability_period'})
            WHERE (seedDf.numericValue IS NOT NULL AND candidateDf.numericValue IS NOT NULL
                   AND abs(candidateDf.numericValue - seedDf.numericValue) <= 5)
               OR (seedDf.subtype = 'permanent' AND candidateDf.subtype = 'permanent')
          })), false) AS disabilityMatched
    WITH c, sim, valuation, evidenceFacts, caseTypeMatched, workAccidentMatched, ageMatched,
         stageMatched, injuryMatched, bodyPartMatched, disabilityMatched,
         (CASE WHEN caseTypeMatched THEN 2.0 ELSE 0.0 END) +
         (CASE WHEN workAccidentMatched THEN 2.0 ELSE 0.0 END) +
         (CASE WHEN ageMatched THEN 1.0 ELSE 0.0 END) +
         (CASE WHEN injuryMatched THEN 1.5 ELSE 0.0 END) +
         (CASE WHEN bodyPartMatched THEN 1.0 ELSE 0.0 END) +
         (CASE WHEN disabilityMatched THEN 2.0 ELSE 0.0 END) +
         (CASE WHEN stageMatched THEN 0.75 ELSE 0.0 END) +
         coalesce(sim.score, 0.0) AS matchScore
    WITH c, sim, valuation, evidenceFacts, caseTypeMatched, workAccidentMatched, ageMatched,
         stageMatched, injuryMatched, bodyPartMatched, disabilityMatched,
         matchScore + (CASE WHEN valuation IS NULL THEN 0.0 ELSE 0.5 END) AS score
    WHERE matchScore > 0.0
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

  if (hits.length === 0) {
    const appliedFilters = collectAppliedFilters(params);
    if (Object.keys(appliedFilters).length > 0) {
      const unfilteredCount = await countAllCases();
      return {
        status: 'filter_too_restrictive',
        seedCaseId,
        hits: [],
        diagnostic: {
          appliedFilters,
          unfilteredCount,
          hint: `Filter combination matched 0 of ${unfilteredCount} cases. OMIT (do not swap to a different value) any field the user did not explicitly mention — especially legalStage, workAccidentFlag, permanentDisability, and disability percent bounds. If you keep retrying with the same filter set or only swap its values, you will keep hitting filter_too_restrictive. Drop the unjustified fields entirely.`,
        },
        meta,
      };
    }
    if (seedCaseId === null) {
      return {
        status: 'insufficient_graph_evidence',
        seedCaseId: null,
        hits: [],
        diagnostic: {
          appliedFilters: {},
          unfilteredCount: 0,
          hint: "Tool was called with no seed AND no narrowing dimension, so similarity cannot be computed (every match flag is false → matchScore=0 → 0 rows). Retry with at least one of: (a) seedCaseId; (b) caseType set to a live vocabulary value; (c) injury set to the user's category term — for the generic Hebrew 'תאונת דרכים' / English 'car accident' pass injury=\"תאונת דרכים\" and the tool will auto-expand to BOTH car-accident severities (car_accident_minor + car_accident_serious); for 'תאונת עבודה' / 'work accident' pass injury=\"תאונת עבודה\" to expand to work_accident; (d) bodyPart with a specific term.",
        },
        meta,
      };
    }
  }

  return {
    status: hits.length > 0 ? 'ok' : 'insufficient_graph_evidence',
    seedCaseId,
    hits,
    meta,
  };
}

/**
 * Collects the optional filters that actually narrowed the query (i.e. survived the
 * trueOrNull / lowerBoundOrNull / upperBoundOrNull / emptyToNull defenses). These are
 * the only filters the LLM consciously chose to set; presenting them back to the model
 * in the diagnostic lets it identify which ones to drop on retry.
 */
function collectAppliedFilters(params: {
  caseType: string | null;
  caseTypes: string[];
  workAccidentFlag: boolean | null;
  ageMin: number | null;
  ageMax: number | null;
  injury: string | null;
  bodyPart: string | null;
  disabilityPercentMin: number | null;
  disabilityPercentMax: number | null;
  permanentDisability: boolean | null;
  legalStage: string | null;
}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (params.caseType !== null) out.caseType = params.caseType;
  if (params.caseTypes.length > 0) out.caseTypes = params.caseTypes.join(',');
  if (params.workAccidentFlag !== null) out.workAccidentFlag = params.workAccidentFlag;
  if (params.ageMin !== null) out.ageMin = params.ageMin;
  if (params.ageMax !== null) out.ageMax = params.ageMax;
  if (params.injury !== null) out.injury = params.injury;
  if (params.bodyPart !== null) out.bodyPart = params.bodyPart;
  if (params.disabilityPercentMin !== null) out.disabilityPercentMin = params.disabilityPercentMin;
  if (params.disabilityPercentMax !== null) out.disabilityPercentMax = params.disabilityPercentMax;
  if (params.permanentDisability !== null) out.permanentDisability = params.permanentDisability;
  if (params.legalStage !== null) out.legalStage = params.legalStage;
  return out;
}

async function countAllCases(): Promise<number> {
  const { rows } = await runReadQueryWithMeta(
    'MATCH (c:Case) RETURN count(c) AS n',
    {},
    z.object({ n: neo4jNumber })
  );
  return rows[0]?.n ?? 0;
}

let _comparableCasesInputSchema: ComparableCasesInputSchema | null = null;
function getComparableCasesInputSchema(): ComparableCasesInputSchema {
  if (!_comparableCasesInputSchema) {
    _comparableCasesInputSchema = buildComparableCasesInputSchema();
  }
  return _comparableCasesInputSchema;
}

export const findComparableCasesByFactsTool: ToolDefinition<
  ComparableCasesInputSchema,
  ComparableCasesByFactsResult
> = {
  name: 'findComparableCasesByFacts',
  label: 'Finding comparable cases from facts',
  get inputSchema(): ComparableCasesInputSchema {
    return getComparableCasesInputSchema();
  },
  execute: findComparableCasesByFacts,
  summarize: (result) => {
    if (result.status === 'ok') {
      return `${result.hits.length} comparable cases, top confidence ${result.hits[0]?.confidence ?? 'low'}`;
    }
    if (result.status === 'filter_too_restrictive') {
      const fields = Object.keys(result.diagnostic?.appliedFilters ?? {}).join(', ');
      return `Filters too restrictive (${fields || 'unknown'}): 0 of ${result.diagnostic?.unfilteredCount ?? 0} cases match — retry without unjustified filters`;
    }
    return 'No graph-backed comparable cases found';
  },
  extractEvidence: (result) =>
    result.hits.map((hit) => ({
      sourceType: 'Case' as const,
      sourceId: hit.caseId,
      label: hit.caseName,
      viaTool: 'findComparableCasesByFacts',
    })),
  traceMeta: (result) => result.meta,
};
