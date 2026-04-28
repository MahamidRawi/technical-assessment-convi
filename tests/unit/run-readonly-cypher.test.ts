import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeValue, validateReadOnlyCypher } from '@/tools/runReadOnlyCypher';

test('validateReadOnlyCypher allows read-only queries', () => {
  assert.equal(validateReadOnlyCypher('MATCH (n) RETURN n'), null);
  assert.equal(validateReadOnlyCypher('OPTIONAL MATCH (a)-[r]->(b) RETURN a, b'), null);
  assert.equal(
    validateReadOnlyCypher(
      'WITH 1 AS x UNWIND [1,2,3] AS y RETURN x, y ORDER BY y SKIP 1 LIMIT 5'
    ),
    null
  );
});

test('validateReadOnlyCypher rejects mutating keywords', () => {
  assert.match(validateReadOnlyCypher('CREATE (n:Foo)') ?? '', /CREATE/);
  assert.match(validateReadOnlyCypher('MATCH (n) DELETE n') ?? '', /DELETE/);
  assert.match(validateReadOnlyCypher('MATCH (n) DETACH DELETE n') ?? '', /DELETE/);
  assert.match(validateReadOnlyCypher('MATCH (n) SET n.x = 1') ?? '', /SET/);
  assert.match(validateReadOnlyCypher('MERGE (n:Foo)') ?? '', /MERGE/);
  assert.match(validateReadOnlyCypher('MATCH (n) REMOVE n.x') ?? '', /REMOVE/);
  assert.match(validateReadOnlyCypher('DROP INDEX foo') ?? '', /DROP/);
  assert.match(
    validateReadOnlyCypher('LOAD CSV FROM "file" AS row RETURN row') ?? '',
    /LOAD/
  );
  assert.match(
    validateReadOnlyCypher('MATCH (n) FOREACH (x IN [] | RETURN x)') ?? '',
    /FOREACH/
  );
});

test('validateReadOnlyCypher blocks procedure calls but allows subqueries', () => {
  assert.match(
    validateReadOnlyCypher('CALL apoc.create.node(["Foo"], {})') ?? '',
    /CALL/
  );
  assert.match(validateReadOnlyCypher('CALL db.indexes()') ?? '', /CALL/);
  assert.equal(
    validateReadOnlyCypher(
      'MATCH (c:Case) CALL { WITH c MATCH (c)-[:HAS_DOCUMENT]->(d) RETURN count(d) AS n } RETURN c, n'
    ),
    null
  );
});

test('validateReadOnlyCypher is case-insensitive', () => {
  assert.match(validateReadOnlyCypher('match (n) create (m:Foo)') ?? '', /CREATE/);
  assert.match(validateReadOnlyCypher('Match (n) Set n.x = 1') ?? '', /SET/);
});

test('validateReadOnlyCypher strips comments before keyword check', () => {
  assert.equal(
    validateReadOnlyCypher('/* CREATE comment */ MATCH (n) RETURN n'),
    null
  );
  assert.equal(validateReadOnlyCypher('// CREATE comment\nMATCH (n) RETURN n'), null);
});

test('validateReadOnlyCypher strips string literals before keyword check', () => {
  assert.equal(
    validateReadOnlyCypher("MATCH (n) WHERE n.action = 'create' RETURN n"),
    null
  );
  assert.equal(
    validateReadOnlyCypher('MATCH (n) WHERE n.note = "DELETE this row" RETURN n'),
    null
  );
});

test('validateReadOnlyCypher does not false-positive on identifier substrings', () => {
  assert.equal(
    validateReadOnlyCypher('MATCH (n) RETURN n.created_at AS createdAt'),
    null
  );
});

test('validateReadOnlyCypher rejects multi-statement queries', () => {
  assert.match(
    validateReadOnlyCypher('MATCH (n) RETURN n; MATCH (m) RETURN m') ?? '',
    /Multi-statement/
  );
  assert.equal(validateReadOnlyCypher('MATCH (n) RETURN n;'), null);
});

test('validateReadOnlyCypher rejects empty input', () => {
  assert.match(validateReadOnlyCypher('') ?? '', /empty/i);
  assert.match(validateReadOnlyCypher('   \n\n\t  ') ?? '', /empty/i);
});

test('normalizeValue truncates long strings', () => {
  const long = 'x'.repeat(600);
  const result = normalizeValue(long);
  assert.equal(typeof result, 'string');
  assert.equal((result as string).length, 501);
  assert.ok((result as string).endsWith('…'));
});

test('normalizeValue passes short strings, numbers, and booleans through', () => {
  assert.equal(normalizeValue('hello'), 'hello');
  assert.equal(normalizeValue(42), 42);
  assert.equal(normalizeValue(true), true);
  assert.equal(normalizeValue(null), null);
});

test('normalizeValue truncates large arrays with a summary item', () => {
  const arr = Array.from({ length: 60 }, (_, i) => i);
  const result = normalizeValue(arr);
  assert.ok(Array.isArray(result));
  const out = result as unknown[];
  assert.equal(out.length, 51);
  assert.equal(out[50], '[+10 more]');
});

test('normalizeValue normalizes Node-shaped objects', () => {
  const node = { labels: ['Case'], properties: { caseId: 'abc' } };
  const result = normalizeValue(node) as { labels: string[]; properties: { caseId: string } };
  assert.deepEqual(result.labels, ['Case']);
  assert.equal(result.properties.caseId, 'abc');
});
