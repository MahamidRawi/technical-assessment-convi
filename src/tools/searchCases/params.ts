import type { SearchCasesInput } from './schema';
import { normalizeTerm, normalizeText } from '@/pipeline/ingest/normalize';
import { SOL_WINDOW_MONTHS } from '@/policy/legalTiming';
import { coerceVocabOrNull } from '@/tools/_shared/dynamicEnums';

export type SearchCasesParamValue = string | number | boolean | null;

export interface SearchCasesParams {
  [key: string]: SearchCasesParamValue;
  caseType: string | null;
  legalStage: string | null;
  phase: string | null;
  status: string | null;
  isSigned: boolean | null;
  isOverdue: boolean | null;
  mainInjury: string | null;
  clientName: string | null;
  injuryName: string | null;
  bodyPart: string | null;
  insurer: string | null;
  hasDocumentCategory: string | null;
  missingDocumentCategory: string | null;
  completionRateMin: number | null;
  completionRateMax: number | null;
  monthsSinceEventMin: number | null;
  monthsSinceEventMax: number | null;
  monthsToSoLMax: number | null;
  solExpired: boolean | null;
  solWindow: number;
  eventDateFrom: string | null;
  eventDateTo: string | null;
  createdAtFrom: string | null;
  createdAtTo: string | null;
  signedAtFrom: string | null;
  signedAtTo: string | null;
  limit: number;
}

function emptyToNull(v: string | undefined): string | null {
  if (v === undefined || v === null) return null;
  return v.trim() === '' ? null : v;
}

function normTermOrNull(
  domain: 'injury' | 'bodyPart' | 'insurer',
  v: string | undefined
): string | null {
  const raw = emptyToNull(v);
  return raw === null ? null : normalizeTerm(domain, raw);
}

function normTextOrNull(v: string | undefined): string | null {
  const raw = emptyToNull(v);
  return raw === null ? null : normalizeText(raw);
}

/**
 * LLMs tend to fill optional fields with neutral-looking defaults (false, 0, 1, 100) even when
 * no filter was requested. These coercions discard those defaults so they don't restrict results.
 * See descriptions in schema.ts for the documented "OMIT" guidance; this is the runtime backstop.
 */
function trueOrNull(v: boolean | undefined): boolean | null {
  return v === true ? true : null;
}

function positiveOrNull(v: number | undefined): number | null {
  return v !== undefined && v > 0 ? v : null;
}

function fractionMaxOrNull(v: number | undefined): number | null {
  return v !== undefined && v < 1 ? v : null;
}

export function buildSearchParams(input: SearchCasesInput): SearchCasesParams {
  return {
    caseType: coerceVocabOrNull('caseType', emptyToNull(input.caseType)),
    legalStage: coerceVocabOrNull('legalStage', emptyToNull(input.legalStage)),
    phase: coerceVocabOrNull('phase', emptyToNull(input.phase)),
    status: coerceVocabOrNull('status', emptyToNull(input.status)),
    isSigned: trueOrNull(input.isSigned),
    isOverdue: trueOrNull(input.isOverdue),
    mainInjury: normTextOrNull(input.mainInjury),
    clientName: normTextOrNull(input.clientName),
    injuryName: normTermOrNull('injury', input.injuryName),
    bodyPart: normTermOrNull('bodyPart', input.bodyPart),
    insurer: normTermOrNull('insurer', input.insurer),
    hasDocumentCategory: emptyToNull(input.hasDocumentCategory),
    missingDocumentCategory: emptyToNull(input.missingDocumentCategory),
    completionRateMin: positiveOrNull(input.completionRateMin),
    completionRateMax: fractionMaxOrNull(input.completionRateMax),
    monthsSinceEventMin: positiveOrNull(input.monthsSinceEventMin),
    monthsSinceEventMax: positiveOrNull(input.monthsSinceEventMax),
    monthsToSoLMax: positiveOrNull(input.monthsToSoLMax),
    solExpired: trueOrNull(input.solExpired),
    solWindow: SOL_WINDOW_MONTHS,
    eventDateFrom: emptyToNull(input.eventDateFrom),
    eventDateTo: emptyToNull(input.eventDateTo),
    createdAtFrom: emptyToNull(input.createdAtFrom),
    createdAtTo: emptyToNull(input.createdAtTo),
    signedAtFrom: emptyToNull(input.signedAtFrom),
    signedAtTo: emptyToNull(input.signedAtTo),
    limit: input.limit,
  };
}
