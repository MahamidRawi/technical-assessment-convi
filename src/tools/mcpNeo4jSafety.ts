// Pre-flight and post-execution safety checks for the MCP read-cypher path.
//
// The validator is mostly schema-driven: it calls into mcpNeo4jSchema to get
// the live graph's labels, relationship types, and per-label properties, then
// rejects Cypher that uses names that do not exist. "Did you mean?"
// suggestions come from Levenshtein distance against the real schema.
//
// A small residual set of structural rules covers things schema introspection
// cannot detect: relationship direction errors, value enum violations that
// would otherwise need full pattern matching, and Hebrew literals where
// English keys are required. These are explicitly listed so the maintenance
// cost of new fabrications stays low (most are caught by the schema check).
//
// Toggle: MCP_NEO4J_SAFETY=false disables both layers. Default: enabled.

import type { Session } from 'neo4j-driver';
import {
  type IntrospectedSchema,
  getCachedSchema,
  introspectSchema,
  suggestClosest,
} from './mcpNeo4jSchema';
import { VALUE_ENUMS, VALUE_ENUMS_BY_PROPERTY } from '@/types/mongo.enums';

export interface SafetyVerdict {
  ok: boolean;
  reason?: string;
  suggestion?: string;
}

export function safetyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MCP_NEO4J_SAFETY?.toLowerCase() !== 'false';
}

function stripCommentsAndStrings(cypher: string): string {
  return cypher
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\'|[^'])*'/g, "''")
    .replace(/"(?:\\"|[^"])*"/g, '""');
}

// === Schema-driven checks ============================================

// Pull every label used in the cypher: matches `(:Label)` and `(var:Label)`.
// Crucially uses `\(` only (not `[`) so relationship type names don't get
// misclassified as labels.
function extractLabels(stripped: string): string[] {
  const out: string[] = [];
  const re = /\(\s*\w*\s*:\s*([A-Z]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) out.push(m[1]);
  return out;
}

// Pull every relationship type used: matches `[:REL_TYPE]`, `[r:REL_TYPE]`,
// and `[:REL_A|REL_B]` alternation. Uses `\[` only so that labels with
// underscores don't accidentally match.
function extractRelationshipTypes(stripped: string): string[] {
  const out: string[] = [];
  const re = /\[\s*\w*\s*:\s*([A-Z][A-Z_|]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    for (const t of m[1].split('|')) {
      if (t) out.push(t);
    }
  }
  return out;
}

// Pull every var.prop access. Excludes function calls (e.g. `count(c)` is
// not `c.<prop>`). Also excludes parameters (`$x`) and label patterns.
function extractPropertyAccesses(stripped: string): string[] {
  const out: string[] = [];
  // \b<var>.<prop>\b where var doesn't start with $ and prop is identifier
  const re = /(?<![$:])\b([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    out.push(m[2]);
  }
  return out;
}

// Pull every literal value comparison: `x.prop = 'literal'` or
// `x.prop IN ['a', 'b']` or `{prop: 'literal'}` for both single- and
// double-quoted strings. Returns [{property, value}] pairs.
//
// We run this on the ORIGINAL cypher because the literal value gets
// blanked during stripping. The risk of false positives (matching inside
// a string) is acceptable here — the only thing we use these pairs for
// is value-enum membership; if a string literal happens to contain
// `caseType:` etc. the match value will be the actual property literal,
// which is rare enough not to cause incidents.
interface LiteralComparison {
  property: string;
  value: string;
}

function extractLiteralComparisons(cypher: string): LiteralComparison[] {
  const out: LiteralComparison[] = [];
  // x.prop = 'literal' or x.prop = "literal"
  const eqRe = /\.([a-zA-Z_]\w*)\s*=\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = eqRe.exec(cypher)) !== null) {
    out.push({ property: m[1], value: m[2] });
  }
  // {prop: 'literal'} inside node patterns
  const mapRe = /\{[^}]*?\b([a-zA-Z_]\w*)\s*:\s*['"]([^'"]+)['"]/g;
  while ((m = mapRe.exec(cypher)) !== null) {
    out.push({ property: m[1], value: m[2] });
  }
  return out;
}

function checkSchema(cypher: string, schema: IntrospectedSchema): SafetyVerdict {
  const stripped = stripCommentsAndStrings(cypher);

  // 1. Labels
  for (const label of extractLabels(stripped)) {
    if (!schema.labels.has(label)) {
      const suggestions = suggestClosest(label, schema.labels);
      return {
        ok: false,
        reason: `Label "${label}" does not exist in the graph.`,
        suggestion:
          suggestions.length > 0
            ? `Did you mean: ${suggestions.join(', ')}?`
            : `Known labels: ${[...schema.labels].slice(0, 10).join(', ')}.`,
      };
    }
  }

  // 2. Relationship types
  for (const rel of extractRelationshipTypes(stripped)) {
    if (!schema.relationships.has(rel)) {
      const suggestions = suggestClosest(rel, schema.relationships);
      return {
        ok: false,
        reason: `Relationship type "${rel}" does not exist in the graph.`,
        suggestion:
          suggestions.length > 0
            ? `Did you mean: ${suggestions.join(', ')}?`
            : `Known relationship types: ${[...schema.relationships].slice(0, 10).join(', ')}.`,
      };
    }
  }

  // 3. Properties — match against the union of all properties (across all
  // labels + relationships). Per-label scoping would require a real Cypher
  // parser to map variables to labels, so we use the more permissive global
  // check: a property is fabricated if it does not exist on ANY node.
  const seen = new Set<string>();
  for (const prop of extractPropertyAccesses(stripped)) {
    if (seen.has(prop)) continue;
    seen.add(prop);
    if (!schema.allProperties.has(prop)) {
      const suggestions = suggestClosest(prop, schema.allProperties);
      return {
        ok: false,
        reason: `Property ".${prop}" does not exist on any node in the graph.`,
        suggestion:
          suggestions.length > 0
            ? `Did you mean: ${suggestions.map((s) => `.${s}`).join(', ')}?`
            : 'Inspect properties via MATCH (n:<Label>) RETURN keys(n) LIMIT 1.',
      };
    }
  }

  return { ok: true };
}

// Pull label-bound property values: matches patterns like
// `(:Stage {name: 'X'})` or `(s:Stage {name: 'X', other: 'Y'})`.
// Returns {label, property, value} so the value-enum check can use the
// fully-qualified key (e.g. Stage.name) from VALUE_ENUMS.
interface LabelBoundProperty {
  label: string;
  property: string;
  value: string;
}

function extractLabelBoundProperties(cypher: string): LabelBoundProperty[] {
  const out: LabelBoundProperty[] = [];
  // Capture (var:Label { ... }) — including multi-key maps.
  const re = /\(\s*\w*\s*:\s*([A-Z]\w*)\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cypher)) !== null) {
    const label = m[1];
    const body = m[2];
    const kvRe = /\b([a-zA-Z_]\w*)\s*:\s*['"]([^'"]+)['"]/g;
    let kv: RegExpExecArray | null;
    while ((kv = kvRe.exec(body)) !== null) {
      out.push({ label, property: kv[1], value: kv[2] });
    }
  }
  return out;
}

// Value-enum check (separate from schema-introspection because the enums
// come from the documented spec, not from sampling the live graph).
// Catches things like c.caseType = 'רכב', c.status = 'signed', and
// (s:Stage {name: 'כתב תביעה'}).
function checkValueEnums(cypher: string): SafetyVerdict {
  // Pass 1: label-bound properties (label is known) — use VALUE_ENUMS.
  for (const { label, property, value } of extractLabelBoundProperties(cypher)) {
    const key = `${label}.${property}`;
    const validValues = VALUE_ENUMS[key];
    if (!validValues) continue;
    if (validValues.includes(value as never)) continue;
    return {
      ok: false,
      reason: `Value "${value}" is not a valid ${key}.`,
      suggestion: `Valid ${key} values: ${validValues.join(', ')}.`,
    };
  }
  // Pass 2: x.prop = 'literal' (label unknown) — use VALUE_ENUMS_BY_PROPERTY.
  for (const { property, value } of extractLiteralComparisons(cypher)) {
    const validValues = VALUE_ENUMS_BY_PROPERTY[property];
    if (!validValues) continue;
    if (validValues.includes(value as never)) continue;
    return {
      ok: false,
      reason: `Value "${value}" is not a valid ${property}.`,
      suggestion: `Valid ${property} values: ${validValues.join(', ')}.`,
    };
  }
  return { ok: true };
}

// === Residual structural / value-enum rules =========================
//
// These are kept because they cannot be derived from a labels+rels+props
// snapshot. Adding more is fine but each entry should encode something
// genuinely structural, not a one-off observed mistake.

interface StructuralRule {
  pattern: RegExp;
  reason: string;
  suggestion: string;
  target?: 'stripped' | 'original';
}

const STRUCTURAL_RULES: StructuralRule[] = [
  // AFFECTS_BODY_PART direction error: relationship goes from Case to BodyPart,
  // so any pattern starting at Injury is wrong. The schema check confirms the
  // type exists, but cannot infer "wrong source label."
  {
    pattern: /\(\s*\w*\s*:\s*Injury[^)]*\)\s*-\[:AFFECTS_BODY_PART\]/i,
    reason: 'AFFECTS_BODY_PART goes from Case, not Injury.',
    suggestion:
      'Use (c:Case)-[:HAS_INJURY]->(i:Injury) and (c)-[:AFFECTS_BODY_PART]->(b:BodyPart) — co-membership on Case is the only link between Injury and BodyPart.',
  },
  // (Hebrew Stage.name and caseType rules deleted — now handled by the
  //  value-enum check via VALUE_ENUMS_BY_PROPERTY.)
];

function checkStructural(cypher: string): SafetyVerdict {
  const stripped = stripCommentsAndStrings(cypher);
  for (const rule of STRUCTURAL_RULES) {
    const haystack = rule.target === 'original' ? cypher : stripped;
    if (rule.pattern.test(haystack)) {
      return { ok: false, reason: rule.reason, suggestion: rule.suggestion };
    }
  }
  return { ok: true };
}

// === Public API =====================================================

export function preflightCypher(cypher: string): SafetyVerdict {
  const schema = getCachedSchema();
  if (schema) {
    const v = checkSchema(cypher, schema);
    if (!v.ok) return v;
  }
  const enumVerdict = checkValueEnums(cypher);
  if (!enumVerdict.ok) return enumVerdict;
  return checkStructural(cypher);
}

// Async variant that ensures the schema is loaded first. The wrapper
// uses this on the first call so that schema introspection happens
// inline rather than blocking later calls.
export async function preflightCypherAsync(cypher: string): Promise<SafetyVerdict> {
  if (!getCachedSchema()) {
    try {
      await introspectSchema();
    } catch {
      // If introspection fails for any reason, fall back to structural-only
      // checks. The wrapper still runs the query — we never block the agent
      // because of a safety-layer outage.
    }
  }
  return preflightCypher(cypher);
}

// Empty-result diagnostic (unchanged): if a query returned [] and looks like
// a literal-caseId match, probe for the literal as sourceId/caseNumber/
// caseName fragment and surface a corrected ID if found.
export async function diagnoseEmptyCaseQuery(
  cypher: string,
  session: Session
): Promise<string | null> {
  const stripped = stripCommentsAndStrings(cypher);
  const hasCaseIdMatch =
    /:\s*Case\b[^)]*\{\s*caseId\s*:\s*\$?[\w]+\s*\}|\.caseId\s*=\s*\$?\w+/i.test(stripped);
  if (!hasCaseIdMatch) return null;
  const literals = [...cypher.matchAll(/['"]([0-9a-fA-F]{16,32}|\(\d+\)[^'"]*)['"]/g)].map(
    (m) => m[1]
  );
  if (literals.length === 0) return null;

  for (const literal of literals) {
    try {
      const result = await session.run(
        `MATCH (c:Case)
         WHERE c.caseId = $id OR c.sourceId = $id OR c.caseNumber = $id OR c.caseName CONTAINS $id
         RETURN c.caseId AS caseId, c.sourceId AS sourceId, c.caseName AS caseName LIMIT 1`,
        { id: literal }
      );
      const row = result.records[0];
      if (!row) continue;
      const canonicalId = row.get('caseId') as string;
      const sourceId = row.get('sourceId') as string;
      const caseName = row.get('caseName') as string;
      if (canonicalId && canonicalId !== literal) {
        return `Case "${literal}" was queried as caseId but the canonical caseId is "${canonicalId}" (sourceId="${sourceId}", caseName="${caseName}"). Re-run with caseId="${canonicalId}".`;
      }
    } catch {
      // best-effort
    }
  }
  return null;
}

export function formatVerdictForAgent(verdict: SafetyVerdict): string {
  if (verdict.ok) return '';
  return `Pre-flight rejected: ${verdict.reason} ${verdict.suggestion ?? ''}`.trim();
}
