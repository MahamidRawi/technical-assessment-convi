import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchCypher } from '@/tools/searchCases/cypher';
import { inputSchema } from '@/tools/searchCases/schema';

test('searchCases coerces neutral default values to null to defend against LLM default-stuffing', () => {
  const allDefaults = buildSearchCypher(
    inputSchema.parse({
      isSigned: false,
      isOverdue: false,
      completionRateMin: 0,
      completionRateMax: 1,
      monthsSinceEventMin: 0,
      monthsSinceEventMax: 0,
      monthsToSoLMax: 0,
    })
  );

  assert.equal(allDefaults.params.isSigned, null);
  assert.equal(allDefaults.params.isOverdue, null);
  assert.equal(allDefaults.params.completionRateMin, null);
  assert.equal(allDefaults.params.completionRateMax, null);
  assert.equal(allDefaults.params.monthsSinceEventMin, null);
  assert.equal(allDefaults.params.monthsSinceEventMax, null);
  assert.equal(allDefaults.params.monthsToSoLMax, null);
});

test('searchCases preserves explicit non-default filters', () => {
  const signed = buildSearchCypher(inputSchema.parse({ isSigned: true }));
  const overdue = buildSearchCypher(inputSchema.parse({ isOverdue: true }));
  const completion = buildSearchCypher(inputSchema.parse({ completionRateMin: 0.5 }));
  const months = buildSearchCypher(inputSchema.parse({ monthsSinceEventMin: 6 }));
  const sol = buildSearchCypher(inputSchema.parse({ monthsToSoLMax: 6 }));

  assert.equal(signed.params.isSigned, true);
  assert.equal(overdue.params.isOverdue, true);
  assert.equal(completion.params.completionRateMin, 0.5);
  assert.equal(months.params.monthsSinceEventMin, 6);
  assert.equal(sol.params.monthsToSoLMax, 6);
});

test('searchCases SoL urgency excludes expired cases', () => {
  const { cypher, countCypher } = buildSearchCypher(inputSchema.parse({ monthsToSoLMax: 6 }));

  assert.match(cypher, /\(\$solWindow - c\.monthsSinceEvent\) >= 0/);
  assert.match(cypher, /\(\$solWindow - c\.monthsSinceEvent\) <= \$monthsToSoLMax/);
  assert.match(countCypher, /\(\$solWindow - c\.monthsSinceEvent\) >= 0/);
});

test('searchCases returns truncation-supporting fields', () => {
  const { cypher, countCypher } = buildSearchCypher(inputSchema.parse({ limit: 5 }));

  assert.match(cypher, /AS monthsToSoL/);
  assert.match(cypher, /c\.eventDate\s+AS eventDate/);
  assert.match(cypher, /c\.createdAt\s+AS createdAt/);
  assert.match(cypher, /c\.signedAt\s+AS signedAt/);
  assert.match(countCypher, /RETURN count\(c\) AS total/);
});
