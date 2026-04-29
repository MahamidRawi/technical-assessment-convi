import type { EvidenceFactNode } from '@/types/graph.types';

export type EvidenceFactKind =
  | 'disability_period'
  | 'regulation_15'
  | 'nii_decision'
  | 'appeal_deadline'
  | 'required_document'
  | 'income_evidence'
  | 'medical_committee'
  | 'work_accident';

export interface OcrFactInput {
  caseId: string;
  documentId: string;
  chunkId: string;
  text: string;
  observedDate: string | null;
}

interface FactDraft {
  kind: EvidenceFactKind;
  subtype: string | null;
  label: string;
  value: string | null;
  numericValue: number | null;
  unit: string | null;
  fromDate: string | null;
  toDate: string | null;
  confidence: number;
  quote: string;
  metadata?: Record<string, unknown>;
}

const DATE_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/g;
const PERCENT_RE = /(\d{1,3})(?:\s*%|\s+אחוז(?:י(?:ם)?)?)/g;

function normalizeYear(raw: string): number {
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
}

export function parseHebrewDate(raw: string): string | null {
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(raw.trim());
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = normalizeYear(yyyy ?? '');
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function extractDates(text: string): string[] {
  const dates: string[] = [];
  for (const match of text.matchAll(DATE_RE)) {
    const parsed = parseHebrewDate(match[0] ?? '');
    if (parsed && !dates.includes(parsed)) dates.push(parsed);
  }
  return dates;
}

function quoteAround(text: string, index: number, radius = 190): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function sentenceAround(text: string, index: number): string {
  const beforePeriod = text.lastIndexOf('.', index);
  const beforeNewline = text.lastIndexOf('\n', index);
  const start = Math.max(beforePeriod, beforeNewline, 0);
  const afterPeriod = text.indexOf('.', index);
  const afterNewline = text.indexOf('\n', index);
  const positiveEnds = [afterPeriod, afterNewline].filter((n) => n >= 0);
  const end = positiveEnds.length > 0 ? Math.min(...positiveEnds) + 1 : text.length;
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function addUnique(out: FactDraft[], seen: Set<string>, draft: FactDraft): void {
  const key = [
    draft.kind,
    draft.subtype,
    draft.value,
    draft.numericValue,
    draft.fromDate,
    draft.toDate,
    draft.quote.slice(0, 120),
  ].join('|');
  if (seen.has(key)) return;
  seen.add(key);
  out.push(draft);
}

function disabilitySubtype(context: string): string {
  if (/קבוע|קבועה|צמית|צמיתה|יציב|יציבה/.test(context)) return 'permanent';
  if (/זמני|זמנית|זמניות|לתקופה/.test(context)) return 'temporary';
  return 'mentioned';
}

function extractDisabilityFacts(text: string, out: FactDraft[], seen: Set<string>): void {
  for (const match of text.matchAll(PERCENT_RE)) {
    const rawPercent = match[1];
    const index = match.index ?? 0;
    const percent = Number(rawPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
    const context = quoteAround(text, index, 230);
    const localContext = sentenceAround(text, index);
    if (!/נכות|נכויות|ועדה רפואית|אחוזי/.test(context)) continue;
    const dates = extractDates(localContext);
    const subtype = disabilitySubtype(localContext);
    addUnique(out, seen, {
      kind: 'disability_period',
      subtype,
      label: `Disability ${subtype}: ${percent}%`,
      value: `${percent}%`,
      numericValue: percent,
      unit: 'percent',
      fromDate: dates[0] ?? null,
      toDate: dates[1] ?? null,
      confidence: subtype === 'mentioned' ? 0.72 : 0.86,
      quote: context,
      metadata: { extractor: 'percent_near_disability' },
    });
  }
}

function extractRegulation15Facts(text: string, out: FactDraft[], seen: Set<string>): void {
  for (const match of text.matchAll(/תקנה\s*15/g)) {
    const context = quoteAround(text, match.index ?? 0);
    let subtype = 'mentioned';
    if (/לא\s+הופעלה|לא\s+חל|לא\s+הוחלה|אין\s+מקום/.test(context)) subtype = 'not_applied';
    else if (/הופעלה|הוחלה|תחול|הגדלה/.test(context)) subtype = 'applied';
    addUnique(out, seen, {
      kind: 'regulation_15',
      subtype,
      label: `Regulation 15 ${subtype}`,
      value: subtype,
      numericValue: null,
      unit: null,
      fromDate: null,
      toDate: null,
      confidence: subtype === 'mentioned' ? 0.7 : 0.9,
      quote: context,
      metadata: { extractor: 'regulation_15_keyword' },
    });
  }
}

function extractNiiDecisionFacts(text: string, out: FactDraft[], seen: Set<string>): void {
  const patterns: Array<[RegExp, string, string, number]> = [
    [/דחיית|דוחה|דחינו|נדח(?:ה|תה)|נאלצים\s+לדחות/g, 'rejected', 'NII claim rejected', 0.86],
    [/אושרה|אושר|הוכרה|הכיר(?:ה)?\s+ב/g, 'accepted', 'NII claim accepted/recognized', 0.82],
    [/החלטת\s+הוועדה|הוועדה\s+הרפואית\s+המסכמת|פרוטוקול\s+הוועדה/g, 'committee_decision', 'NII medical committee decision', 0.84],
    [/ערעור|ערר|תובענה|בית\s+הדין\s+לעבודה/g, 'appeal_notice', 'NII appeal/labor court notice', 0.78],
  ];
  for (const [regex, subtype, label, confidence] of patterns) {
    for (const match of text.matchAll(regex)) {
      const context = quoteAround(text, match.index ?? 0);
      if (!/ביטוח\s+לאומי|המוסד\s+לביטוח\s+לאומי|נפגעי\s+עבודה|גמלה|ועדה/.test(context)) continue;
      addUnique(out, seen, {
        kind: 'nii_decision',
        subtype,
        label,
        value: subtype,
        numericValue: null,
        unit: null,
        fromDate: extractDates(context)[0] ?? null,
        toDate: null,
        confidence,
        quote: context,
        metadata: { extractor: 'nii_decision_keywords' },
      });
    }
  }
}

function extractAppealDeadlineFacts(text: string, out: FactDraft[], seen: Set<string>): void {
  const patterns: Array<[RegExp, number, string, string]> = [
    [/60\s+יום/g, 60, 'days', '60-day appeal deadline'],
    [/שישים\s+יום/g, 60, 'days', '60-day appeal deadline'],
    [/12\s+חודשים/g, 12, 'months', '12-month appeal/renewal deadline'],
    [/שנים\s+עשר\s+חודשים/g, 12, 'months', '12-month appeal/renewal deadline'],
  ];
  for (const [regex, amount, unit, label] of patterns) {
    for (const match of text.matchAll(regex)) {
      const context = quoteAround(text, match.index ?? 0);
      if (!/ערעור|ערר|תובענה|בית\s+הדין|לחדש|מסמכים\s+חסרים|זכאות/.test(context)) continue;
      addUnique(out, seen, {
        kind: 'appeal_deadline',
        subtype: unit,
        label,
        value: `${amount} ${unit}`,
        numericValue: amount,
        unit,
        fromDate: null,
        toDate: null,
        confidence: 0.84,
        quote: context,
        metadata: { extractor: 'appeal_deadline_keywords' },
      });
    }
  }
}

function extractRequiredDocumentFacts(text: string, out: FactDraft[], seen: Set<string>): void {
  const requirements: Array<[RegExp, string]> = [
    [/תלושי\s+שכר|תלוש(?:י)?\s+משכורת/g, 'salary_slips'],
    [/מכתב\s+מהמעסיק|אישור\s+מעסיק/g, 'employer_letter'],
    [/רופא\s+תעסוקתי|אישור\s+רופא\s+תעסוקתי/g, 'occupational_doctor'],
    [/מסמכים\s+רפואיים|תיעוד\s+רפואי|חומר\s+רפואי/g, 'medical_records'],
    [/דיסק(?:ים)?\s+של\s+בדיקות|בדיקות\s+הדמיה|CT|MRI/g, 'imaging_discs'],
    [/טופס\s+בל\/?250|בל\s*250/g, 'btl_250_form'],
    [/אישור\s+משטרה|דוח\s+משטרה/g, 'police_report'],
  ];
  for (const [regex, subtype] of requirements) {
    for (const match of text.matchAll(regex)) {
      const context = quoteAround(text, match.index ?? 0);
      if (!/צריך|נדרש|חסר|חסרים|להביא|לשלוח|להעביר|לא\s+קיבלנו|אנא|מסמכים/.test(context)) continue;
      addUnique(out, seen, {
        kind: 'required_document',
        subtype,
        label: `Required document: ${subtype}`,
        value: subtype,
        numericValue: null,
        unit: null,
        fromDate: null,
        toDate: null,
        confidence: 0.78,
        quote: context,
        metadata: { extractor: 'required_document_keywords' },
      });
    }
  }
}

function extractIncomeFacts(text: string, out: FactDraft[], seen: Set<string>): void {
  const patterns: Array<[RegExp, string, string, number]> = [
    [/ירידה\s+בהכנסה|ירידה\s+משמעותית\s+.*הכנסה|הכנסותיו/g, 'income_reduction', 'Income reduction evidence', 0.82],
    [/חצי\s+משרה|4\s+שעות|ארבע\s+שעות/g, 'reduced_work_capacity', 'Reduced work capacity / hours', 0.82],
    [/תלושי\s+שכר|תלוש(?:י)?\s+משכורת/g, 'salary_slips', 'Salary slip evidence', 0.78],
    [/חזר\s+לעבודה|חזרה\s+לעבודה|שב\s+לעבודה/g, 'returned_to_work', 'Return to work evidence', 0.78],
    [/מכתב\s+מהמעסיק|אישור\s+מעסיק/g, 'employer_letter', 'Employer letter evidence', 0.78],
  ];
  for (const [regex, subtype, label, confidence] of patterns) {
    for (const match of text.matchAll(regex)) {
      const context = quoteAround(text, match.index ?? 0);
      addUnique(out, seen, {
        kind: 'income_evidence',
        subtype,
        label,
        value: subtype,
        numericValue: null,
        unit: null,
        fromDate: extractDates(context)[0] ?? null,
        toDate: extractDates(context)[1] ?? null,
        confidence,
        quote: context,
        metadata: { extractor: 'income_keywords' },
      });
    }
  }
}

function extractMedicalCommitteeFacts(text: string, out: FactDraft[], seen: Set<string>): void {
  for (const match of text.matchAll(/ועדה\s+רפואית|הוועדה\s+הרפואית|פרוטוקול\s+הוועדה/g)) {
    const context = quoteAround(text, match.index ?? 0);
    const dates = extractDates(context);
    const specialty = /כירורגיה\s+אורטופדית|אורטופד(?:י|ית)|נוירולוג(?:י|ית)|פסיכיאטר(?:י|ית)/.exec(context)?.[0] ?? null;
    addUnique(out, seen, {
      kind: 'medical_committee',
      subtype: specialty ?? 'committee',
      label: specialty ? `Medical committee: ${specialty}` : 'Medical committee evidence',
      value: specialty,
      numericValue: null,
      unit: null,
      fromDate: dates[0] ?? null,
      toDate: null,
      confidence: 0.82,
      quote: context,
      metadata: { extractor: 'medical_committee_keywords' },
    });
  }
}

function extractWorkAccidentFacts(text: string, out: FactDraft[], seen: Set<string>): void {
  const patterns: Array<[RegExp, string]> = [
    [/נפגעי\s+עבודה/g, 'work_injury_claim'],
    [/תאונת\s+עבודה|פגיעה\s+בעבודה/g, 'work_accident'],
    [/דמי\s+פגיעה/g, 'injury_allowance'],
    [/תאריך\s+פגיעה/g, 'injury_date'],
  ];
  for (const [regex, subtype] of patterns) {
    for (const match of text.matchAll(regex)) {
      const context = quoteAround(text, match.index ?? 0);
      addUnique(out, seen, {
        kind: 'work_accident',
        subtype,
        label: `Work accident evidence: ${subtype}`,
        value: subtype,
        numericValue: null,
        unit: null,
        fromDate: extractDates(context)[0] ?? null,
        toDate: null,
        confidence: 0.82,
        quote: context,
        metadata: { extractor: 'work_accident_keywords' },
      });
    }
  }
}

export function extractEvidenceFacts(input: OcrFactInput): EvidenceFactNode[] {
  const text = input.text.trim();
  if (!text) return [];
  const drafts: FactDraft[] = [];
  const seen = new Set<string>();

  extractDisabilityFacts(text, drafts, seen);
  extractRegulation15Facts(text, drafts, seen);
  extractNiiDecisionFacts(text, drafts, seen);
  extractAppealDeadlineFacts(text, drafts, seen);
  extractRequiredDocumentFacts(text, drafts, seen);
  extractIncomeFacts(text, drafts, seen);
  extractMedicalCommitteeFacts(text, drafts, seen);
  extractWorkAccidentFacts(text, drafts, seen);

  return drafts.map((draft, index) => ({
    factId: `${input.chunkId}:fact:${index + 1}`,
    caseId: input.caseId,
    documentId: input.documentId,
    chunkId: input.chunkId,
    kind: draft.kind,
    subtype: draft.subtype,
    label: draft.label,
    value: draft.value,
    numericValue: draft.numericValue,
    unit: draft.unit,
    fromDate: draft.fromDate,
    toDate: draft.toDate,
    observedDate: input.observedDate,
    confidence: draft.confidence,
    quote: draft.quote.slice(0, 700),
    metadata: draft.metadata ? JSON.stringify(draft.metadata) : null,
  }));
}
