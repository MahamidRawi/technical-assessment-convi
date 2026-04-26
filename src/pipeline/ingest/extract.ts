import type { MongoCase, FinancialProjection } from '../../types/mongo.types';
import { normalizeTerm, normalizeText } from './normalize';

export interface InjuryRow {
  caseId: string;
  name: string;
  normalized: string;
  status: 'initial' | 'current';
}

export interface BodyPartRow {
  caseId: string;
  name: string;
  normalized: string;
}

export interface InsurerRow {
  caseId: string;
  name: string;
  normalized: string;
}

export interface ExpertRow {
  caseId: string;
  name: string;
  normalized: string;
  specialty: string | null;
  key: string;
  side: 'ours' | 'court';
}

export interface ExtractedRows {
  injuryRows: InjuryRow[];
  bodyPartRows: BodyPartRow[];
  insurerRows: InsurerRow[];
  expertRows: ExpertRow[];
}

function pushInjuries(
  out: InjuryRow[],
  caseId: string,
  names: string[] | undefined,
  status: 'initial' | 'current'
): void {
  for (const raw of names ?? []) {
    const name = raw.trim();
    if (!name) continue;
    out.push({ caseId, name, normalized: normalizeTerm('injury', name), status });
  }
}

function pushBodyParts(out: BodyPartRow[], caseId: string, names: string[] | undefined): void {
  for (const raw of names ?? []) {
    const name = raw.trim();
    if (!name) continue;
    out.push({ caseId, name, normalized: normalizeTerm('bodyPart', name) });
  }
}

function pushExperts(
  out: ExpertRow[],
  caseId: string,
  experts: Array<{ name?: string; specialty?: string | null }> | undefined,
  side: 'ours' | 'court'
): void {
  for (const e of experts ?? []) {
    const name = e.name?.trim();
    if (!name) continue;
    const specialty = e.specialty?.trim() || null;
    const normalized = normalizeText(name);
    const normalizedSpecialty = specialty ? normalizeText(specialty) : '';
    out.push({ caseId, name, normalized, specialty, key: `${normalized}|${normalizedSpecialty}`, side });
  }
}

export function extractRowsFromCase(
  mongoCase: MongoCase,
  projection: FinancialProjection | null,
  rows: ExtractedRows
): void {
  const { caseId } = mongoCase;
  pushInjuries(rows.injuryRows, caseId, mongoCase.injuries?.initial, 'initial');
  pushInjuries(rows.injuryRows, caseId, mongoCase.injuries?.current, 'current');
  pushBodyParts(rows.bodyPartRows, caseId, mongoCase.medicalInfo?.injuredBodyParts ?? undefined);

  const insurerName = projection?.projection?.caseData?.insuranceCompany?.trim();
  if (insurerName) {
    rows.insurerRows.push({
      caseId,
      name: insurerName,
      normalized: normalizeTerm('insurer', insurerName),
    });
  }

  pushExperts(rows.expertRows, caseId, projection?.projection?.caseData?.experts?.ours, 'ours');
  pushExperts(rows.expertRows, caseId, projection?.projection?.caseData?.experts?.court, 'court');
}

export function dedupeByKey<T, K>(items: T[], key: (item: T) => K): T[] {
  const seen = new Map<K, T>();
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return Array.from(seen.values());
}
