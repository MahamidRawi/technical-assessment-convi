const INJURY_SYNONYMS: Record<string, string> = {
  'כאבי גב': 'כאב גב',
  'כאב גב תחתון': 'כאב גב',
  'כאבי גב תחתון': 'כאב גב',
  'כאבי צואר': 'כאב צואר',
  'כאבי ראש': 'כאב ראש',
  'מיגרנה': 'כאב ראש',
  'פריצת דיסק': 'דיסק',
  'בלט דיסק': 'דיסק',
  'שבר מרוסק': 'שבר',
  'שבר סגור': 'שבר',
  'חבלה': 'חבלות',
};

const BODY_PART_SYNONYMS: Record<string, string> = {
  'גב תחתון': 'גב',
  'גב עליון': 'גב',
  'עמוד שדרה': 'גב',
  'צוואר': 'צואר',
  'כתף ימין': 'כתף',
  'כתף שמאל': 'כתף',
  'ברך ימין': 'ברך',
  'ברך שמאל': 'ברך',
};

const INSURER_LEGAL_SUFFIX_TOKENS_RAW = [
  'חברה',
  'לביטוח',
  'ביטוח',
  'בעמ',
  'מבטחים',
  'ישראלי',
  'הישראלי',
];

const INSURER_OVERRIDES: Record<string, string> = {
  'ביטוח ישיר': 'ביטוח ישיר',
  'המוסד לביטוח לאומי': 'ביטוח לאומי',
  'ביטוח לאומי': 'ביטוח לאומי',
  'נימרוד חברה לביטוח': 'נימרוד',
};

function stripInsurerLegalSuffix(name: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  while (
    tokens.length > 1 &&
    INSURER_LEGAL_SUFFIX_TOKENS_FOLDED.has(tokens[tokens.length - 1] ?? '')
  ) {
    tokens.pop();
  }
  return tokens.join(' ');
}

function pickPrimarySegment(name: string): string {
  const segments = name
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return segments[segments.length - 1] ?? name;
}

function canonicalizeInsurer(folded: string): string {
  const segment = pickPrimarySegment(folded);
  const fromOverride = INSURER_OVERRIDES_FOLDED[segment];
  if (fromOverride) return fromOverride;
  return stripInsurerLegalSuffix(segment);
}

const FINAL_FOLD: Record<string, string> = {
  'ם': 'מ',
  'ן': 'נ',
  'ץ': 'צ',
  'ף': 'פ',
  'ך': 'כ',
};

function foldFinals(text: string): string {
  return text.replace(/[םןץףך]/g, (ch) => FINAL_FOLD[ch] ?? ch);
}

function foldEntries(table: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(table)) out[foldFinals(k)] = foldFinals(v);
  return out;
}

const INJURY_TABLE = foldEntries(INJURY_SYNONYMS);
const BODY_PART_TABLE = foldEntries(BODY_PART_SYNONYMS);
const INSURER_OVERRIDES_FOLDED = foldEntries(INSURER_OVERRIDES);
const INSURER_LEGAL_SUFFIX_TOKENS_FOLDED = new Set(
  INSURER_LEGAL_SUFFIX_TOKENS_RAW.map(foldFinals)
);

export type SynonymDomain = 'injury' | 'bodyPart' | 'insurer';

export function resolveSynonym(domain: SynonymDomain, term: string): string {
  if (domain === 'injury') return INJURY_TABLE[term] ?? term;
  if (domain === 'bodyPart') return BODY_PART_TABLE[term] ?? term;
  return canonicalizeInsurer(term);
}
