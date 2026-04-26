import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTerm, normalizeText } from '@/pipeline/ingest/normalize';

test('insurer normalization collapses long corporate-form variants to canonical short name', () => {
  const variants = [
    'הראל',
    'הראל ביטוח',
    'הראל חברה לביטוח',
    'הראל חברה לביטוח בע"מ',
  ];
  const normalized = variants.map((v) => normalizeTerm('insurer', v));
  for (const value of normalized) {
    assert.equal(value, 'הראל', `expected ${variants[normalized.indexOf(value)]} → הראל, got ${value}`);
  }
});

test('insurer normalization handles ASCII quote stripping for בע"מ suffix', () => {
  // "הראל חברה לביטוח בע\"מ" should normalize identically to the version
  // with the gershayim character removed.
  const withAsciiQuote = normalizeTerm('insurer', 'הראל חברה לביטוח בע"מ');
  const withoutQuote = normalizeTerm('insurer', 'הראל חברה לביטוח בעמ');
  assert.equal(withAsciiQuote, withoutQuote);
  assert.equal(withAsciiQuote, 'הראל');
});

test('Ayalon variants all collapse to a single canonical form', () => {
  // Final-letter folding turns ן→נ, so the canonical form is "איילונ".
  const canonical = normalizeTerm('insurer', 'איילון');
  for (const v of ['איילון', 'איילון ביטוח', 'איילון חברה לביטוח', 'איילון חברה לביטוח בע"מ']) {
    assert.equal(normalizeTerm('insurer', v), canonical, `failed for ${v}`);
  }
});

test('plain ASCII quote stripping survives normalization for non-insurer text', () => {
  // ד"ר נעמה רוזן should normalize to a form without the ASCII quote.
  const result = normalizeText('ד"ר נעמה רוזן');
  assert.ok(!result.includes('"'), `expected no ASCII quote in ${result}`);
});

test('Phoenix variants collapse to הפניקס', () => {
  for (const v of ['הפניקס', 'הפניקס ביטוח', 'הפניקס חברה לביטוח בע"מ', 'הפניקס הישראלי']) {
    assert.equal(normalizeTerm('insurer', v), 'הפניקס', `failed for ${v}`);
  }
});

test('heuristic auto-canonicalizes any new insurer that follows brand+suffix convention', () => {
  // No table entry exists for these — they collapse purely from the
  // suffix-stripping heuristic.
  const a = normalizeTerm('insurer', 'מנורה מבטחים');
  const b = normalizeTerm('insurer', 'מנורה');
  assert.equal(a, b, 'מנורה variants should auto-canonicalize');

  const c = normalizeTerm('insurer', 'כלל חברה לביטוח');
  const d = normalizeTerm('insurer', 'כלל ביטוח');
  const e = normalizeTerm('insurer', 'כלל');
  assert.equal(c, d);
  assert.equal(d, e);
});

test('multi-defendant strings pick the trailing insurer segment', () => {
  // Real datapoint: "אתר סקי מים תל אביב, עיריית תל אביב-יפו, איילון חברה לביטוח בע\"מ"
  const multi = normalizeTerm(
    'insurer',
    'אתר סקי מים תל אביב, עיריית תל אביב-יפו, איילון חברה לביטוח בע"מ'
  );
  const single = normalizeTerm('insurer', 'איילון');
  assert.equal(multi, single, 'multi-defendant string should resolve to the insurer segment');
});

test('override table beats the heuristic for edge cases', () => {
  // "ביטוח ישיר" — the heuristic would strip "ביטוח" as a suffix and leave "ישיר".
  // The override table preserves the brand intact.
  const beto = normalizeTerm('insurer', 'ביטוח ישיר');
  assert.equal(beto, 'ביטוח ישיר');

  // National Insurance Institute — different convention; canonical short name is "ביטוח לאומי".
  const nii = normalizeTerm('insurer', 'המוסד לביטוח לאומי');
  const niiShort = normalizeTerm('insurer', 'ביטוח לאומי');
  assert.equal(nii, niiShort);
});
