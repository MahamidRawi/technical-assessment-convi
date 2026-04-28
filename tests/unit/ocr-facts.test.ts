import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MongoFileSchema, FinancialProjectionSchema } from '@/types/mongo.types';
import { buildDocumentChunks, normalizePageRange, splitTextIntoChunks } from '@/pipeline/ingest/documentContent';
import { extractEvidenceFacts, parseHebrewDate } from '@/pipeline/ingest/ocrFacts';
import { buildValuationRows } from '@/pipeline/ingest/writeValuations';

test('MongoFileSchema accepts real OCR shapes from exported files data', () => {
  const files = JSON.parse(readFileSync('data/convi-assessment.files.json', 'utf8')) as unknown[];
  const sample = files.find((row) => {
    const f = row as {
      processedData?: {
        ocr_metadata?: { combined_text?: string };
        chunks?: Array<{ extracted_text?: string }>;
      };
    };
    return f.processedData?.ocr_metadata?.combined_text || f.processedData?.chunks?.some((c) => c.extracted_text);
  });
  assert.ok(sample, 'expected at least one real OCR file in data export');
  const parsed = MongoFileSchema.parse(sample);
  assert.ok(parsed.processedData?.ocr_metadata?.combined_text || parsed.processedData?.chunks?.length);
});

test('FinancialProjectionSchema accepts real exported valuation shapes', () => {
  const projections = JSON.parse(readFileSync('data/convi-assessment.case_financial_projections.json', 'utf8')) as unknown[];
  assert.ok(projections.length > 0, 'expected real financial projection rows in data export');
  for (const projection of projections) {
    assert.doesNotThrow(() => FinancialProjectionSchema.parse(projection));
  }
});

test('chunk builder prioritizes provided OCR chunks and keeps stable source metadata', () => {
  const file = MongoFileSchema.parse({
    _id: 'doc-1',
    caseId: 'CASE-1',
    fileName: 'nii.pdf',
    processedData: {
      chunks: [
        { chunk_number: 1, extracted_text: 'עמוד ראשון\nנכות זמנית 20% לתקופה 01/01/2025 עד 01/03/2025', gcs_uri: 'gs://chunk-1', page_range: { start: 1, end: 3 } },
      ],
      ocr_metadata: { combined_text: 'fallback should not be used', summary: 'summary' },
    },
  });

  const chunks = buildDocumentChunks(file, 'CASE-1');

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.chunkId, 'doc-1:chunk:1');
  assert.equal(chunks[0]?.source, 'processedData.chunks');
  assert.equal(chunks[0]?.gcsUri, 'gs://chunk-1');
  assert.equal(chunks[0]?.pageRange, '1-3');
});

test('normalizePageRange accepts string and OCR range object shapes', () => {
  assert.equal(normalizePageRange('4-5'), '4-5');
  assert.equal(normalizePageRange({ start: 7, end: 7 }), '7');
  assert.equal(normalizePageRange({ start: '8', end: '10' }), '8-10');
  assert.equal(normalizePageRange({}), null);
});

test('splitTextIntoChunks handles long OCR text without one huge graph node', () => {
  const longText = Array.from({ length: 80 }, (_, i) => `פסקה ${i} עם מסמך רפואי ונכות זמנית`).join('\n\n');
  const chunks = splitTextIntoChunks(longText);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 2600));
});

test('OCR fact extraction parses disability, Regulation 15, NII, income, required document, and deadline facts', () => {
  const text = [
    'הוועדה הרפואית המסכמת קבעה נכות זמנית בשיעור 40% לתקופה 01-05-2025 עד 31-07-2025.',
    'בנוסף נקבעה נכות קבועה בשיעור 10% החל מ-01/02/2026.',
    'תקנה 15 לא הופעלה משום שהתובע חזר לעבודה ואין ירידה בהכנסותיו.',
    'המוסד לביטוח לאומי דחה את התביעה לדמי פגיעה ומציין שניתן להגיש ערעור תוך 60 יום.',
    'נדרשים תלושי שכר ומכתב מהמעסיק לצורך בחינת הירידה בהכנסה.',
  ].join('\n');

  const facts = extractEvidenceFacts({
    caseId: 'CASE-1',
    documentId: 'doc-1',
    chunkId: 'doc-1:chunk:1',
    observedDate: '2026-01-01',
    text,
  });
  const kinds = new Set(facts.map((fact) => fact.kind));

  assert.ok(facts.some((fact) => fact.kind === 'disability_period' && fact.subtype === 'temporary' && fact.numericValue === 40));
  assert.ok(facts.some((fact) => fact.kind === 'disability_period' && fact.subtype === 'permanent' && fact.numericValue === 10));
  assert.ok(facts.some((fact) => fact.kind === 'regulation_15' && fact.subtype === 'not_applied'));
  assert.ok(kinds.has('nii_decision'));
  assert.ok(kinds.has('appeal_deadline'));
  assert.ok(kinds.has('required_document'));
  assert.ok(kinds.has('income_evidence'));
  assert.ok(facts.every((fact) => fact.quote.length <= 700));
});

test('parseHebrewDate normalizes supported date formats', () => {
  assert.equal(parseHebrewDate('01/02/2026'), '2026-02-01');
  assert.equal(parseHebrewDate('31-07-25'), '2025-07-31');
  assert.equal(parseHebrewDate('not a date'), null);
});

test('valuation mapper parses compensation, fees, and damage components', () => {
  const projection = FinancialProjectionSchema.parse({
    _id: 'projection-1',
    caseId: 'CASE-1',
    status: 'current',
    version: 3,
    projection: {
      analysisDate: '2026-01-02T00:00:00Z',
      caseData: {
        damageBreakdown: {
          painAndSuffering: 15000,
          futureLosses: 100000,
          niDeduction: 5000,
          totalEstimate: 110000,
        },
      },
      financials: {
        estimatedCompensation: { min: 100000, max: 130000, basis: 'projection basis' },
        estimatedFeeBeforeVAT: { min: 20000, max: 25000 },
        feePercentage: '8% + 17%',
      },
      classification: {
        confidence: 'high',
      },
    },
  });

  const rows = buildValuationRows(projection);

  assert.ok(rows);
  assert.equal(rows.valuation.compensationMin, 100000);
  assert.equal(rows.valuation.compensationMax, 130000);
  assert.equal(rows.valuation.totalEstimate, 110000);
  assert.equal(rows.valuation.basis, 'projection basis');
  assert.ok(rows.components.some((component) => component.kind === 'future_losses' && component.amount === 100000));
});
