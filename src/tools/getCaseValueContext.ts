import { z } from 'zod';
import { runReadQuery } from './_shared/runReadQuery';
import {
  neo4jNullableNumber,
  neo4jNullableString,
  neo4jString,
} from './_shared/neo4jMap';
import { resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';
import {
  buildComparableCasesInputSchema,
  findComparableCasesByFacts,
  type ComparableCaseByFacts,
  type ComparableValuation,
} from './findComparableCasesByFacts';

export interface ValueFact {
  factId: string;
  kind: string;
  subtype: string | null;
  label: string;
  value: string | null;
  numericValue: number | null;
  quote: string;
}

export interface ValueRangeSummary {
  comparableCount: number;
  compensationMin: number | null;
  compensationMedian: number | null;
  compensationMax: number | null;
}

export interface CaseValueContextResult {
  status: 'ok' | 'insufficient_graph_evidence';
  targetCaseId: string | null;
  targetQuestion: string | null;
  targetValuation: ComparableValuation | null;
  targetFacts: ValueFact[];
  comparableCases: ComparableCaseByFacts[];
  rangeSummary: ValueRangeSummary;
  missingValueEvidence: string[];
}

function buildInputSchema() {
  return buildComparableCasesInputSchema().extend({
    targetQuestion: z.string().optional(),
  });
}

type GetCaseValueContextInputSchema = ReturnType<typeof buildInputSchema>;

let _inputSchema: GetCaseValueContextInputSchema | null = null;
function getInputSchema(): GetCaseValueContextInputSchema {
  if (!_inputSchema) _inputSchema = buildInputSchema();
  return _inputSchema;
}

const valuationRowSchema = z.object({
  valuationId: neo4jString,
  compensationMin: neo4jNullableNumber,
  compensationMax: neo4jNullableNumber,
  totalEstimate: neo4jNullableNumber,
  feeMin: neo4jNullableNumber,
  feeMax: neo4jNullableNumber,
});

const factRowSchema = z.object({
  factId: neo4jString,
  kind: neo4jString,
  subtype: neo4jNullableString,
  label: neo4jString,
  value: neo4jNullableString,
  numericValue: neo4jNullableNumber,
  quote: neo4jString,
});

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  return left === undefined || right === undefined ? null : (left + right) / 2;
}

function rangeSummary(cases: ComparableCaseByFacts[]): ValueRangeSummary {
  const values = cases
    .flatMap((hit) => [
      hit.valuation?.compensationMin ?? null,
      hit.valuation?.compensationMax ?? hit.valuation?.totalEstimate ?? null,
    ])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return {
    comparableCount: cases.filter((hit) => hit.valuation !== null).length,
    compensationMin: values.length > 0 ? Math.min(...values) : null,
    compensationMedian: median(values),
    compensationMax: values.length > 0 ? Math.max(...values) : null,
  };
}

async function getTargetValuation(caseId: string): Promise<ComparableValuation | null> {
  const rows = await runReadQuery(
    `
    MATCH (:Case {caseId: $caseId})-[:HAS_VALUATION]->(valuation:CaseValuation)
    RETURN valuation.valuationId AS valuationId,
           valuation.compensationMin AS compensationMin,
           valuation.compensationMax AS compensationMax,
           valuation.totalEstimate AS totalEstimate,
           valuation.feeMin AS feeMin,
           valuation.feeMax AS feeMax
    ORDER BY valuation.status = 'current' DESC, valuation.analysisDate DESC
    LIMIT 1
    `,
    { caseId },
    valuationRowSchema
  );
  const row = rows[0];
  return row
    ? {
        valuationId: row.valuationId,
        compensationMin: row.compensationMin,
        compensationMax: row.compensationMax,
        totalEstimate: row.totalEstimate,
        feeMin: row.feeMin,
        feeMax: row.feeMax,
      }
    : null;
}

async function getTargetFacts(caseId: string): Promise<ValueFact[]> {
  return runReadQuery(
    `
    MATCH (:Case {caseId: $caseId})-[:HAS_EVIDENCE_FACT]->(fact:EvidenceFact)
    WHERE fact.kind IN ['disability_period', 'income_evidence', 'work_accident', 'regulation_15', 'nii_decision', 'medical_committee']
    RETURN fact.factId AS factId,
           fact.kind AS kind,
           fact.subtype AS subtype,
           fact.label AS label,
           fact.value AS value,
           fact.numericValue AS numericValue,
           fact.quote AS quote
    ORDER BY fact.kind ASC, fact.confidence DESC
    LIMIT 30
    `,
    { caseId },
    factRowSchema
  );
}

function missingEvidence(
  targetCaseId: string | null,
  targetValuation: ComparableValuation | null,
  targetFacts: ValueFact[],
  comparables: ComparableCaseByFacts[]
): string[] {
  const facts = [...targetFacts, ...comparables.flatMap((hit) => hit.evidenceFacts)];
  const hasKind = (kind: string): boolean => facts.some((fact) => fact.kind === kind);
  const missing: string[] = [];
  if (targetCaseId && !targetValuation) missing.push('current case valuation projection');
  if (!hasKind('disability_period')) missing.push('OCR disability percentage / period facts');
  if (!hasKind('income_evidence')) missing.push('income or salary-impact evidence');
  if (!hasKind('nii_decision')) missing.push('NII decision / committee outcome facts');
  if (comparables.filter((hit) => hit.valuation !== null).length === 0) {
    missing.push('comparable cases with valuation ranges');
  }
  return missing;
}

async function execute(
  input: z.infer<GetCaseValueContextInputSchema>
): Promise<CaseValueContextResult> {
  const targetCaseId = emptyToNull(input.caseId) ? await resolveCaseId(input.caseId ?? '') : null;
  const comparableResult = await findComparableCasesByFacts({
    ...input,
    caseId: targetCaseId ?? undefined,
  });
  const targetValuation = targetCaseId ? await getTargetValuation(targetCaseId) : null;
  const targetFacts = targetCaseId ? await getTargetFacts(targetCaseId) : [];
  const summary = rangeSummary(comparableResult.hits);
  const missing = missingEvidence(targetCaseId, targetValuation, targetFacts, comparableResult.hits);
  const hasEvidence =
    targetValuation !== null ||
    targetFacts.length > 0 ||
    summary.comparableCount > 0 ||
    comparableResult.hits.some((hit) => hit.evidenceFacts.length > 0);

  return {
    status: hasEvidence ? 'ok' : 'insufficient_graph_evidence',
    targetCaseId,
    targetQuestion: emptyToNull(input.targetQuestion),
    targetValuation,
    targetFacts,
    comparableCases: comparableResult.hits,
    rangeSummary: summary,
    missingValueEvidence: missing,
  };
}

export const getCaseValueContextTool: ToolDefinition<
  GetCaseValueContextInputSchema,
  CaseValueContextResult
> = {
  name: 'getCaseValueContext',
  label: 'Building graph-backed value context',
  get inputSchema(): GetCaseValueContextInputSchema {
    return getInputSchema();
  },
  execute,
  summarize: (result) =>
    result.status === 'ok'
      ? `${result.comparableCases.length} comparables, ${result.rangeSummary.comparableCount} with valuation ranges`
      : 'Insufficient graph evidence for value context',
  extractEvidence: (result) => [
    ...result.comparableCases.map((hit) => ({
      sourceType: 'Case' as const,
      sourceId: hit.caseId,
      label: hit.caseName,
      viaTool: 'getCaseValueContext',
    })),
    ...result.targetFacts.map((fact) => ({
      sourceType: 'Document' as const,
      sourceId: fact.factId,
      label: fact.label,
      viaTool: 'getCaseValueContext',
    })),
  ],
};
