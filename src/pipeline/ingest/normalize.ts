import {
  extractISODate,
  extractSourceId,
  type MongoCase,
  type MongoContact,
  type MongoFile,
  type FinancialProjection,
} from '../../types/mongo.types';
import type { CaseNode } from '../../types/graph.types';
import { resolveSynonym, type SynonymDomain } from './synonyms';

const NIQQUD_AND_CANTILLATION = /[\u0591-\u05C7]/g;
const FINAL_LETTER_MAP: Record<string, string> = {
  'ם': 'מ',
  'ן': 'נ',
  'ץ': 'צ',
  'ף': 'פ',
  'ך': 'כ',
};
const FINAL_LETTER_RE = /[םןץףך]/g;

function stripHebrewMarks(text: string): string {
  // Strip Hebrew niqqud/cantillation + Hebrew abbreviation marks (maqaf,
  // geresh, gershayim) + ASCII quote/apostrophe that source data commonly
  // substitutes for the Unicode forms (e.g. בע"מ, ד"ר, פרופ'). Without
  // ASCII-quote stripping, "הראל חברה לביטוח בע\"מ" doesn't reduce to
  // "הראל חברה לביטוח בעמ" and won't match the synonym table.
  return text
    .replace(NIQQUD_AND_CANTILLATION, '')
    .replace(/[\u05BE\u05F3\u05F4\u0022\u0027]/g, '');
}

function foldFinalLetters(text: string): string {
  return text.replace(FINAL_LETTER_RE, (ch) => FINAL_LETTER_MAP[ch] ?? ch);
}

function baseNormalize(text: string): string {
  return foldFinalLetters(stripHebrewMarks(text))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizeTerm(domain: SynonymDomain, text: string): string {
  return resolveSynonym(domain, baseNormalize(text));
}

export function normalizeText(text: string): string {
  return baseNormalize(text);
}

export function normalizeContactName(name: string): string {
  return baseNormalize(name);
}

export function normalizeCaseNode(
  mongoCase: MongoCase,
  projection: FinancialProjection | null
): CaseNode {
  const caseStage = projection?.projection?.caseStage;
  const quarterlyTargets = projection?.projection?.quarterlyTargets;
  return {
    sourceId: extractSourceId(mongoCase._id),
    caseId: mongoCase.caseId,
    caseName: mongoCase.caseName,
    caseNumber: mongoCase.caseNumber ?? null,
    caseType: mongoCase.caseType,
    legalStage: mongoCase.legalStage,
    subStage: mongoCase.subStage ?? null,
    phase: mongoCase.phase,
    status: mongoCase.status,
    isSigned: mongoCase.isSigned,
    clientContactId: mongoCase.clientContactId ?? null,
    createdAt: extractISODate(mongoCase.createdAt),
    eventDate: extractISODate(mongoCase.eventDate),
    signedAt: extractISODate(mongoCase.signedAt),
    legalStageEnteredAt: extractISODate(mongoCase.legalStageEnteredAt),
    updatedAt: extractISODate(mongoCase.updatedAt),
    completionRate: projection?.projection?.checklist?.completionRate ?? 0,
    missingCritical: projection?.projection?.checklist?.missingCritical ?? [],
    monthsSinceEvent: projection?.projection?.timing?.monthsSinceEvent ?? null,
    isOverdue: projection?.projection?.timing?.isOverdue ?? null,
    mainInjury: projection?.projection?.caseData?.mainInjury ?? null,
    aiGeneratedSummary: mongoCase.aiGeneratedSummary ?? null,
    slaStatus: caseStage?.slaStatus ?? null,
    slaForCurrentStage: caseStage?.slaForCurrentStage ?? null,
    slaDetails: caseStage?.slaDetails ?? null,
    daysInCurrentStage: caseStage?.daysInCurrentStage ?? null,
    expectedCompletionDate: quarterlyTargets?.expectedCompletionDate ?? null,
  };
}

export function resolveClientContactId(
  caseNode: CaseNode,
  contacts: MongoContact[]
): string | null {
  if (caseNode.clientContactId) {
    const hit = contacts.find((c) => extractSourceId(c._id) === caseNode.clientContactId);
    if (hit) return extractSourceId(hit._id);
  }
  const candidates = contacts.filter(
    (c) => c.contactType === 'client' && (c.caseIds ?? []).includes(caseNode.caseId)
  );
  return candidates.length === 1 ? extractSourceId(candidates[0]._id) : null;
}

export function resolveFileCaseId(file: MongoFile, knownCaseIds: Set<string>): string | null {
  if (file.caseId && knownCaseIds.has(file.caseId)) return file.caseId;
  const refs = file.legacyMetadata?.documentRefs ?? [];
  for (const ref of refs) {
    if (ref.document_id && knownCaseIds.has(ref.document_id)) return ref.document_id;
  }
  return null;
}
