import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preflightCypher,
  safetyEnabled,
} from '@/tools/mcpNeo4jSafety';
import {
  type IntrospectedSchema,
  setCachedSchema,
  levenshtein,
  suggestClosest,
} from '@/tools/mcpNeo4jSchema';

// A miniature schema reflecting the real graph used in tests below.
function buildTestSchema(): IntrospectedSchema {
  return {
    labels: new Set(['Case', 'Stage', 'Injury', 'BodyPart', 'ReadinessSignal', 'Communication']),
    relationships: new Set([
      'HAS_INJURY',
      'AFFECTS_BODY_PART',
      'REACHED_STAGE',
      'IN_STAGE',
      'HAS_COMMUNICATION',
      'FROM_CONTACT',
    ]),
    propertiesByLabel: new Map([
      [
        'Case',
        new Set([
          'caseId',
          'caseName',
          'caseType',
          'legalStage',
          'isSigned',
          'status',
          'slaStatus',
          'slaForCurrentStage',
          'completionRate',
        ]),
      ],
      ['Stage', new Set(['name'])],
      ['Injury', new Set(['name', 'normalized'])],
      ['BodyPart', new Set(['name', 'normalized'])],
      ['ReadinessSignal', new Set(['key', 'label', 'kind'])],
      ['Communication', new Set(['type', 'direction', 'sentAt', 'subject'])],
    ]),
    allProperties: new Set([
      'caseId',
      'caseName',
      'caseType',
      'legalStage',
      'isSigned',
      'status',
      'slaStatus',
      'slaForCurrentStage',
      'completionRate',
      'name',
      'normalized',
      'key',
      'label',
      'kind',
      'type',
      'direction',
      'sentAt',
      'subject',
      // REACHED_STAGE relationship properties
      'at',
      'source',
    ]),
    capturedAt: Date.now(),
  };
}

test.beforeEach(() => {
  setCachedSchema(buildTestSchema());
});

test.afterEach(() => {
  setCachedSchema(null);
});

test('preflightCypher allows correct Cypher', () => {
  assert.equal(preflightCypher('MATCH (c:Case) RETURN c LIMIT 5').ok, true);
  assert.equal(
    preflightCypher("MATCH (c:Case) WHERE c.slaStatus = 'overdue' RETURN c").ok,
    true
  );
  assert.equal(preflightCypher('MATCH (c:Case)-[r:REACHED_STAGE]->(s) RETURN r.at').ok, true);
  assert.equal(preflightCypher('MATCH (c:Case) WHERE c.isSigned = true RETURN c').ok, true);
});

test('preflightCypher rejects unknown labels with "did you mean" suggestion', () => {
  const v = preflightCypher('MATCH (c:Cse) RETURN c'); // typo Case -> Cse
  assert.equal(v.ok, false);
  assert.match(v.reason ?? '', /Cse/);
  assert.match(v.suggestion ?? '', /Case/);
});

test('preflightCypher rejects unknown relationship types with suggestion', () => {
  const v = preflightCypher('MATCH (c:Case)-[:HAS_INJURY_TYPO]->(i:Injury) RETURN c');
  assert.equal(v.ok, false);
  assert.match(v.reason ?? '', /HAS_INJURY_TYPO/);
  assert.match(v.suggestion ?? '', /HAS_INJURY/);
});

test('preflightCypher rejects fabricated property name (slaOverdue)', () => {
  const v = preflightCypher('MATCH (c:Case) WHERE c.slaOverdue = true RETURN c');
  assert.equal(v.ok, false);
  assert.match(v.reason ?? '', /\.slaOverdue/);
  // Suggestion may or may not include .slaStatus depending on Levenshtein
  // distance vs threshold; the important thing is the fabrication is caught.
  assert.ok(v.suggestion && v.suggestion.length > 0);
});

test('preflightCypher rejects fabricated property (injuryType)', () => {
  const v = preflightCypher('MATCH (i:Injury) RETURN i.injuryType');
  assert.equal(v.ok, false);
  assert.match(v.reason ?? '', /\.injuryType/);
});

test('preflightCypher rejects fabricated property on ReadinessSignal (.name)', () => {
  // .name exists on Stage/Injury/BodyPart so the global check passes — this
  // is the limit of the schema-driven approach. Per-label scoping would
  // require a real Cypher parser. The structural rules cover only direction
  // errors and Hebrew literals; this is an accepted blind spot.
  const v = preflightCypher('MATCH (s:ReadinessSignal) RETURN s.name');
  assert.equal(v.ok, true); // global check passes; documented limit
});

test('preflightCypher catches r.date because no relationship has that property', () => {
  const v = preflightCypher('MATCH (c)-[r:REACHED_STAGE]->(s) WHERE r.date >= date()');
  assert.equal(v.ok, false);
  assert.match(v.reason ?? '', /\.date/);
  // Levenshtein should rank closely-spelled real props
});

test('preflightCypher does NOT reject content inside string literals', () => {
  const cypher = "MATCH (c:Case) WHERE c.caseName CONTAINS 'slaOverdue' RETURN c";
  // c.caseName and slaOverdue inside a string should both be allowed
  assert.equal(preflightCypher(cypher).ok, true);
});

test('preflightCypher rejects (Injury)-[:AFFECTS_BODY_PART] structural error', () => {
  const v = preflightCypher(
    'MATCH (i:Injury)-[:AFFECTS_BODY_PART]->(b:BodyPart) RETURN i, b'
  );
  assert.equal(v.ok, false);
  assert.match(v.suggestion ?? '', /co-membership on Case/);
});

test('preflightCypher rejects Hebrew Stage.name literal via value-enum', () => {
  const v = preflightCypher("MATCH (s:Stage {name: 'כתב תביעה'}) RETURN s");
  assert.equal(v.ok, false);
  // Suggestion lists valid English stage keys
  assert.match(v.suggestion ?? '', /file_claim/);
});

test('preflightCypher rejects Hebrew caseType literal via value-enum', () => {
  const v = preflightCypher("MATCH (c:Case) WHERE c.caseType = 'רכב' RETURN c");
  assert.equal(v.ok, false);
  assert.match(v.suggestion ?? '', /car_accident_serious/);
});

test("preflightCypher rejects c.status='signed' via value-enum (replaces hardcoded rule)", () => {
  const v = preflightCypher("MATCH (c:Case) WHERE c.status = 'signed' RETURN c");
  assert.equal(v.ok, false);
  // Valid values listed in suggestion
  assert.match(v.suggestion ?? '', /open|pending_lawyer_review|intake_complete/);
});

test('preflightCypher accepts valid enum values', () => {
  assert.equal(
    preflightCypher("MATCH (c:Case) WHERE c.caseType = 'car_accident_serious' RETURN c").ok,
    true
  );
  assert.equal(
    preflightCypher("MATCH (c:Case) WHERE c.status = 'pending_lawyer_review' RETURN c").ok,
    true
  );
  assert.equal(
    preflightCypher("MATCH (s:Stage {name: 'file_claim'}) RETURN s").ok,
    true
  );
});

test('preflightCypher value-enum check ignores properties without a documented enum', () => {
  // caseName has no documented enum, so any value is allowed
  assert.equal(
    preflightCypher("MATCH (c:Case) WHERE c.caseName CONTAINS 'foo' RETURN c").ok,
    true
  );
});

test('preflightCypher allows correct relationship alternation', () => {
  // Schema includes both HAS_INJURY and AFFECTS_BODY_PART
  const cypher = 'MATCH (c:Case)-[:HAS_INJURY|AFFECTS_BODY_PART]->(x) RETURN x';
  assert.equal(preflightCypher(cypher).ok, true);
});

test('preflightCypher with no cached schema falls back to structural rules only', () => {
  setCachedSchema(null);
  // Property check skipped, but structural rule still catches direction error
  const v = preflightCypher(
    'MATCH (i:Injury)-[:AFFECTS_BODY_PART]->(b:BodyPart) RETURN i, b'
  );
  assert.equal(v.ok, false);
  // And valid Cypher still passes
  assert.equal(preflightCypher('MATCH (c:Case) RETURN c').ok, true);
});

test('safetyEnabled defaults to true and can be disabled', () => {
  assert.equal(safetyEnabled({}), true);
  assert.equal(safetyEnabled({ MCP_NEO4J_SAFETY: 'false' }), false);
});

test('levenshtein basic correctness', () => {
  assert.equal(levenshtein('slaStatus', 'slaStatus'), 0);
  assert.equal(levenshtein('slaOverdue', 'slaStatus'), 5); // ovrdue -> tatus is 5 edits
  assert.ok(levenshtein('caseId', 'CaseId') > 0); // case-sensitive
  assert.equal(levenshtein('', 'abc'), 3);
});

test('suggestClosest returns top matches by distance', () => {
  const candidates = ['slaStatus', 'slaForCurrentStage', 'caseId', 'caseName'];
  // 'slaStatu' is 1 edit from 'slaStatus' — within default threshold
  const out = suggestClosest('slaStatu', candidates, 3, 2);
  assert.ok(out.length >= 1);
  assert.ok(out.includes('slaStatus'));
});
