import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  ALLOWED_FACT_KINDS,
  extractEvidenceFactsBatchWithLLM,
  extractEvidenceFactsWithLLM,
  quoteAppearsInText,
  resolveExtractorVersion,
  setLlmBatchCallOverrideForTests,
  setLlmCallOverrideForTests,
  validateLlmFact,
} from '@/pipeline/ingest/llmEvidenceFacts';
import { configureOcrLlmCachePath } from '@/pipeline/ingest/ocrLlmCache';
import { mergeEvidenceFacts } from '@/pipeline/ingest/mergeEvidenceFacts';
import type { EvidenceFactNode } from '@/types/graph.types';

const CHUNK_TEXT =
  'הוועדה הרפואית קבעה נכות קבועה בשיעור 25% החל מ-01/02/2026. ' +
  'תקנה 15 לא הופעלה. נדרשים תלושי שכר לבחינת הירידה בהכנסה.';

async function withTempCache(fn: () => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-llm-cache-'));
  const cachePath = path.join(dir, 'cache.json');
  configureOcrLlmCachePath(cachePath);
  try {
    await fn();
  } finally {
    setLlmCallOverrideForTests(null);
    setLlmBatchCallOverrideForTests(null);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('valid LLM JSON becomes EvidenceFactNode[]', async () => {
  await withTempCache(async () => {
    setLlmCallOverrideForTests(async () => ({
      facts: [
        {
          kind: 'disability_period',
          subtype: 'permanent',
          label: 'Disability permanent: 25%',
          numericValue: 25,
          unit: 'percent',
          fromDate: '2026-02-01',
          confidence: 0.92,
          quote: 'נכות קבועה בשיעור 25% החל מ-01/02/2026',
        },
      ],
      inputTokens: 100,
      outputTokens: 50,
    }));

    const facts = await extractEvidenceFactsWithLLM({
      caseId: 'CASE-1',
      documentId: 'doc-1',
      chunkId: 'doc-1:chunk:1',
      chunkHash: 'hash-1',
      text: CHUNK_TEXT,
      observedDate: '2026-04-01',
    });

    assert.equal(facts.length, 1);
    const [fact] = facts;
    assert.ok(fact);
    assert.equal(fact.kind, 'disability_period');
    assert.equal(fact.subtype, 'permanent');
    assert.equal(fact.numericValue, 25);
    assert.equal(fact.fromDate, '2026-02-01');
    assert.equal(fact.confidence, 0.92);
    assert.equal(fact.source, 'llm');
    assert.equal(fact.extractorVersion, resolveExtractorVersion());
    assert.equal(fact.chunkHash, 'hash-1');
    assert.equal(fact.factId, 'doc-1:chunk:1:llm:1');
  });
});

test('unknown fact kind is rejected', () => {
  const fact = validateLlmFact(
    {
      kind: 'made_up_kind',
      quote: 'נכות קבועה בשיעור 25%',
    },
    CHUNK_TEXT,
    null
  );
  assert.equal(fact, null);
});

test('missing quote is rejected', () => {
  const fact = validateLlmFact(
    {
      kind: 'disability_period',
      quote: '',
    },
    CHUNK_TEXT,
    null
  );
  assert.equal(fact, null);
});

test('quote that does not appear in chunk text is rejected', () => {
  const fact = validateLlmFact(
    {
      kind: 'disability_period',
      quote: 'נכות בשיעור 80% (paraphrased — not in chunk)',
    },
    CHUNK_TEXT,
    null
  );
  assert.equal(fact, null);
});

test('quote longer than 700 chars is capped', () => {
  const longQuote = 'נכות קבועה בשיעור 25% ' + 'א'.repeat(2000);
  // Keep the long quote contiguous in the chunk text so the appearance check
  // passes after the 700-char cap.
  const text = `סקירה כללית. ${longQuote} סוף.`;
  const fact = validateLlmFact(
    {
      kind: 'disability_period',
      subtype: 'permanent',
      quote: longQuote,
      confidence: 0.9,
    },
    text,
    null
  );
  assert.ok(fact);
  assert.equal(fact!.quote.length, 700);
});

test('confidence is clamped to [0, 1]', () => {
  const high = validateLlmFact(
    {
      kind: 'disability_period',
      subtype: 'permanent',
      quote: 'נכות קבועה בשיעור 25%',
      confidence: 7.4,
    },
    CHUNK_TEXT,
    null
  );
  const low = validateLlmFact(
    {
      kind: 'disability_period',
      subtype: 'permanent',
      quote: 'נכות קבועה בשיעור 25%',
      confidence: -2,
    },
    CHUNK_TEXT,
    null
  );
  assert.equal(high?.confidence, 1);
  assert.equal(low?.confidence, 0);
});

test('cache hit avoids second OpenAI call', async () => {
  await withTempCache(async () => {
    let calls = 0;
    setLlmCallOverrideForTests(async () => {
      calls++;
      return {
        facts: [
          {
            kind: 'regulation_15',
            subtype: 'not_applied',
            quote: 'תקנה 15 לא הופעלה',
            confidence: 0.85,
          },
        ],
        inputTokens: 80,
        outputTokens: 40,
      };
    });

    const args = {
      caseId: 'CASE-1',
      documentId: 'doc-1',
      chunkId: 'doc-1:chunk:1',
      chunkHash: 'hash-cache',
      text: CHUNK_TEXT,
      observedDate: null,
    };

    const a = await extractEvidenceFactsWithLLM(args);
    const b = await extractEvidenceFactsWithLLM({
      ...args,
      caseId: 'CASE-2',
      documentId: 'doc-2',
      chunkId: 'doc-2:chunk:1',
    });

    assert.equal(calls, 1);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(b[0]?.caseId, 'CASE-2');
    assert.equal(b[0]?.documentId, 'doc-2');
    assert.equal(b[0]?.chunkId, 'doc-2:chunk:1');
    assert.equal(b[0]?.factId, 'doc-2:chunk:1:llm:1');
    assert.equal(b[0]?.kind, 'regulation_15');
  });
});

test('mergeEvidenceFacts keeps regex duplicate over LLM duplicate', () => {
  const regex: EvidenceFactNode = {
    factId: 'doc-1:chunk:1:fact:1',
    caseId: 'CASE-1',
    documentId: 'doc-1',
    chunkId: 'doc-1:chunk:1',
    kind: 'disability_period',
    subtype: 'permanent',
    label: 'Disability permanent: 25%',
    value: '25%',
    numericValue: 25,
    unit: 'percent',
    fromDate: '2026-02-01',
    toDate: null,
    observedDate: null,
    confidence: 0.86,
    quote: 'נכות קבועה בשיעור 25% החל מ-01/02/2026',
    metadata: null,
    source: 'regex',
    extractorVersion: 'regex-v1',
    chunkHash: 'hash-x',
  };
  const llmDuplicate: EvidenceFactNode = {
    ...regex,
    factId: 'doc-1:chunk:1:llm:1',
    confidence: 0.92,
    source: 'llm',
    extractorVersion: 'openai-ocr-v1',
  };
  const llmNew: EvidenceFactNode = {
    factId: 'doc-1:chunk:1:llm:2',
    caseId: 'CASE-1',
    documentId: 'doc-1',
    chunkId: 'doc-1:chunk:1',
    kind: 'required_document',
    subtype: 'salary_slips',
    label: 'Required document: salary_slips',
    value: 'salary_slips',
    numericValue: null,
    unit: null,
    fromDate: null,
    toDate: null,
    observedDate: null,
    confidence: 0.78,
    quote: 'נדרשים תלושי שכר',
    metadata: null,
    source: 'llm',
    extractorVersion: 'openai-ocr-v1',
    chunkHash: 'hash-x',
  };

  const merged = mergeEvidenceFacts([regex], [llmDuplicate, llmNew]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.source, 'regex');
  assert.equal(merged[0]?.confidence, 0.86);
  assert.equal(merged[1]?.source, 'llm');
  assert.equal(merged[1]?.kind, 'required_document');
});

test('quoteAppearsInText is whitespace- and case-insensitive', () => {
  assert.equal(quoteAppearsInText('נכות קבועה בשיעור 25%', CHUNK_TEXT), true);
  assert.equal(quoteAppearsInText('   נכות   קבועה   בשיעור   25%   ', CHUNK_TEXT), true);
  assert.equal(quoteAppearsInText('REGULATION 15 NOT APPLIED', 'תקנה 15 לא הופעלה.'), false);
});

test('batched extraction validates per chunk and partial cache hits skip the API', async () => {
  await withTempCache(async () => {
    const chunkAText =
      'הוועדה הרפואית קבעה נכות קבועה בשיעור 25% החל מ-01/02/2026.';
    const chunkBText = 'תקנה 15 לא הופעלה. נדרשים תלושי שכר.';
    const chunkCText = 'הוועדה דחתה את התביעה — ניתן לערער תוך 30 ימים.';

    let batchCalls = 0;
    let lastBatchSize = 0;
    setLlmBatchCallOverrideForTests(async (inputs) => {
      batchCalls++;
      lastBatchSize = inputs.length;
      // Return facts keyed by *position in the batch*. The position in the
      // batch is what `chunkIndex` points to inside the framework.
      const resultsByIndex = new Map<number, unknown[]>();
      inputs.forEach((input, idx) => {
        if (input.text.includes('נכות קבועה')) {
          resultsByIndex.set(idx, [
            {
              kind: 'disability_period',
              subtype: 'permanent',
              quote: 'נכות קבועה בשיעור 25% החל מ-01/02/2026',
              numericValue: 25,
              fromDate: '2026-02-01',
              confidence: 0.9,
            },
          ]);
        } else if (input.text.includes('תקנה 15')) {
          resultsByIndex.set(idx, [
            {
              kind: 'regulation_15',
              subtype: 'not_applied',
              quote: 'תקנה 15 לא הופעלה',
              confidence: 0.85,
            },
            // Cross-attribution — quote is from chunk A, but attached here.
            // Per-chunk validation must reject this (quote not in chunk B's text).
            {
              kind: 'disability_period',
              subtype: 'permanent',
              quote: 'נכות קבועה בשיעור 25%',
              confidence: 0.5,
            },
          ]);
        } else if (input.text.includes('דחתה')) {
          resultsByIndex.set(idx, [
            {
              kind: 'nii_decision',
              subtype: 'rejected',
              quote: 'הוועדה דחתה את התביעה',
              confidence: 0.88,
            },
          ]);
        }
      });
      return { resultsByIndex, inputTokens: 600, outputTokens: 200 };
    });

    const inputs = [
      {
        caseId: 'CASE-X',
        documentId: 'doc-x',
        chunkId: 'doc-x:chunk:1',
        chunkHash: 'hash-batch-A',
        text: chunkAText,
        observedDate: null,
      },
      {
        caseId: 'CASE-X',
        documentId: 'doc-x',
        chunkId: 'doc-x:chunk:2',
        chunkHash: 'hash-batch-B',
        text: chunkBText,
        observedDate: null,
      },
      {
        caseId: 'CASE-X',
        documentId: 'doc-x',
        chunkId: 'doc-x:chunk:3',
        chunkHash: 'hash-batch-C',
        text: chunkCText,
        observedDate: null,
      },
    ];

    const stats: Array<{ cached: boolean }> = [];
    const first = await extractEvidenceFactsBatchWithLLM(inputs, {
      onCallComplete: (s) => stats.push({ cached: s.cached }),
    });

    assert.equal(batchCalls, 1);
    assert.equal(lastBatchSize, 3);
    assert.equal(first.length, 3);
    assert.equal(first[0]?.length, 1);
    assert.equal(first[0]?.[0]?.kind, 'disability_period');
    // Cross-chunk attribution rejected by the per-chunk quote check.
    assert.equal(first[1]?.length, 1);
    assert.equal(first[1]?.[0]?.kind, 'regulation_15');
    assert.equal(first[2]?.[0]?.kind, 'nii_decision');
    assert.equal(stats.filter((s) => !s.cached).length, 3);

    // Re-run with one new chunk + two cached → API only sees the new one.
    const newChunkText = 'הוועדה דרשה תלושי שכר נוספים מהמעסיק.';
    const second = await extractEvidenceFactsBatchWithLLM(
      [
        inputs[0]!, // cached
        inputs[1]!, // cached
        {
          ...inputs[2]!,
          chunkId: 'doc-x:chunk:4',
          chunkHash: 'hash-batch-D',
          text: newChunkText,
        },
      ],
      {}
    );

    // One API call total for the new chunk only.
    assert.equal(batchCalls, 2);
    assert.equal(lastBatchSize, 1);
    assert.equal(second[0]?.[0]?.kind, 'disability_period');
    assert.equal(second[1]?.[0]?.kind, 'regulation_15');
  });
});

test('ALLOWED_FACT_KINDS matches the EvidenceFactKind set', () => {
  const expected = [
    'disability_period',
    'regulation_15',
    'nii_decision',
    'appeal_deadline',
    'required_document',
    'income_evidence',
    'medical_committee',
    'work_accident',
  ];
  assert.deepEqual([...ALLOWED_FACT_KINDS], expected);
});
