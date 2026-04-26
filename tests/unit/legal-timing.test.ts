import test from 'node:test';
import assert from 'node:assert/strict';
import { SOL_WINDOW_MONTHS, deriveLegalFlags } from '@/policy/legalTiming';

test('SoL window matches Israeli personal-injury statute (7 years = 84 months)', () => {
  assert.equal(SOL_WINDOW_MONTHS, 84);
});

test('a 24-month-old case is healthy, far from SoL', () => {
  const flags = deriveLegalFlags(24);
  assert.equal(flags.monthsToSoL, 60);
  assert.equal(flags.approachingSoL, false);
});

test('a 73-month-old case is approaching SoL (within 12 months)', () => {
  const flags = deriveLegalFlags(73);
  assert.equal(flags.monthsToSoL, 11);
  assert.equal(flags.approachingSoL, true);
});

test('a 91-month-old case is recently expired but still within the recently-expired window', () => {
  const flags = deriveLegalFlags(91);
  assert.equal(flags.monthsToSoL, -7);
  // approachingSoL window includes a 12-month grace period after expiry.
  assert.equal(flags.approachingSoL, true);
});

test('a 100-month-old case is fully past the recently-expired window', () => {
  const flags = deriveLegalFlags(100);
  assert.equal(flags.monthsToSoL, -16);
  assert.equal(flags.approachingSoL, false);
});

test('null monthsSinceEvent returns no flags', () => {
  const flags = deriveLegalFlags(null);
  assert.equal(flags.monthsToSoL, null);
  assert.equal(flags.approachingSoL, false);
});
