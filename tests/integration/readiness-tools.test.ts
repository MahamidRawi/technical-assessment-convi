import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { closeNeo4j, createSession } from '@/db/neo4j';
import { loadTestGraph } from '@/scripts/load-test-graph';
import { findCaseTool } from '@/tools/findCase';
import { findSimilarCasesTool } from '@/tools/findSimilarCases';
import { getCaseCommunicationsTool } from '@/tools/getCaseCommunications';
import { getCaseDocumentsTool } from '@/tools/getCaseDocuments';
import { getCaseOverviewTool } from '@/tools/getCaseOverview';
import { toNumber } from '@/tools/_shared/neo4jMap';
import { runCompareCaseToReadinessPattern } from '@/tools/compareCaseToReadinessPattern';
import { runDeriveReadinessPattern } from '@/tools/deriveReadinessPattern';
import { runEstimateTimeToStage } from '@/tools/estimateTimeToStage';
import { runExplainReadinessDecision } from '@/tools/explainReadinessDecision';
import { getCaseEvidenceTool } from '@/tools/getCaseEvidence';
import { rankCasesByStageTransitionTimeTool } from '@/tools/rankCasesByStageTransitionTime';
import { searchDocumentEvidenceTool } from '@/tools/searchDocumentEvidence';
import { getCaseDocumentFactsTool } from '@/tools/getCaseDocumentFacts';
import { findComparableCasesByFactsTool } from '@/tools/findComparableCasesByFacts';
import { getCaseValueContextTool } from '@/tools/getCaseValueContext';
import { persistSignalWriteSet } from '@/pipeline/analytics/signals/persist';
import { persistCohortWriteSet } from '@/pipeline/analytics/cohorts/persist';
import type { SignalWriteSet } from '@/pipeline/analytics/signals/types';
import type { CohortWriteSet } from '@/pipeline/analytics/cohorts/types';

const hasNeo4j = Boolean(process.env.NEO4J_URI);
const fixturePath = resolve(process.cwd(), 'tests', 'fixtures', 'readiness-fixture.cypher');
const sparseFixturePath = resolve(
  process.cwd(),
  'tests',
  'fixtures',
  'sparse-readiness-fixture.cypher'
);

async function resetFixture(): Promise<void> {
  await loadTestGraph(fixturePath);
}

async function resetSparseFixture(): Promise<void> {
  await loadTestGraph(sparseFixturePath);
}

async function countNodes(label: string): Promise<number> {
  const session = createSession();
  try {
    const result = await session.run(`MATCH (n:${label}) RETURN count(n) AS count`);
    return toNumber(result.records[0]?.get('count'));
  } finally {
    await session.close();
  }
}

async function seedOcrValueFixture(): Promise<void> {
  const session = createSession();
  try {
    await session.run(`
      MATCH (target:Case {caseId: 'CASE-TARGET'})
      MATCH (targetDoc:Document {sourceId: 'doc:target:medical'})
      SET target.clientAge = 30, target.workAccidentFlag = true
      MERGE (targetChunk:DocumentChunk {chunkId: 'doc:target:medical:chunk:1'})
      SET targetChunk.documentId = targetDoc.sourceId,
          targetChunk.caseId = target.caseId,
          targetChunk.chunkNumber = 1,
          targetChunk.pageRange = '1-2',
          targetChunk.text = 'הוועדה הרפואית קבעה נכות זמנית בשיעור 40% לתקופה 01-05-2025 עד 31-07-2025. תקנה 15 לא הופעלה. נדרשים תלושי שכר ומכתב מהמעסיק לצורך בדיקת ירידה בהכנסה.',
          targetChunk.textPreview = 'הוועדה הרפואית קבעה נכות זמנית בשיעור 40% לתקופה 01-05-2025 עד 31-07-2025. תקנה 15 לא הופעלה.',
          targetChunk.summary = 'NII temporary disability and missing income documents',
          targetChunk.gcsUri = 'gs://test/target.pdf',
          targetChunk.charCount = 180,
          targetChunk.source = 'test'
      MERGE (targetDoc)-[:HAS_CHUNK]->(targetChunk)
      MERGE (targetDisability:EvidenceFact {factId: 'fact:target:disability'})
      SET targetDisability.caseId = target.caseId,
          targetDisability.documentId = targetDoc.sourceId,
          targetDisability.chunkId = targetChunk.chunkId,
          targetDisability.kind = 'disability_period',
          targetDisability.subtype = 'temporary',
          targetDisability.label = 'Disability temporary: 40%',
          targetDisability.value = '40%',
          targetDisability.numericValue = 40,
          targetDisability.unit = 'percent',
          targetDisability.fromDate = '2025-05-01',
          targetDisability.toDate = '2025-07-31',
          targetDisability.observedDate = '2026-03-10',
          targetDisability.confidence = 0.9,
          targetDisability.quote = targetChunk.textPreview,
          targetDisability.metadata = '{}'
      MERGE (targetIncome:EvidenceFact {factId: 'fact:target:income'})
      SET targetIncome.caseId = target.caseId,
          targetIncome.documentId = targetDoc.sourceId,
          targetIncome.chunkId = targetChunk.chunkId,
          targetIncome.kind = 'income_evidence',
          targetIncome.subtype = 'salary_slips',
          targetIncome.label = 'Salary slip evidence',
          targetIncome.value = 'salary_slips',
          targetIncome.numericValue = null,
          targetIncome.unit = null,
          targetIncome.fromDate = null,
          targetIncome.toDate = null,
          targetIncome.observedDate = '2026-03-10',
          targetIncome.confidence = 0.8,
          targetIncome.quote = 'נדרשים תלושי שכר ומכתב מהמעסיק לצורך בדיקת ירידה בהכנסה.',
          targetIncome.metadata = '{}'
      MERGE (target)-[:HAS_EVIDENCE_FACT]->(targetDisability)
      MERGE (target)-[:HAS_EVIDENCE_FACT]->(targetIncome)
      MERGE (targetDoc)-[:SUPPORTS_FACT]->(targetDisability)
      MERGE (targetDoc)-[:SUPPORTS_FACT]->(targetIncome)
      MERGE (targetChunk)-[:SUPPORTS_FACT]->(targetDisability)
      MERGE (targetChunk)-[:SUPPORTS_FACT]->(targetIncome)
      MERGE (targetValuation:CaseValuation {valuationId: 'valuation:target'})
      SET targetValuation.caseId = target.caseId,
          targetValuation.compensationMin = 100000,
          targetValuation.compensationMax = 150000,
          targetValuation.feeMin = 20000,
          targetValuation.feeMax = 30000,
          targetValuation.totalEstimate = 125000,
          targetValuation.basis = 'test valuation',
          targetValuation.status = 'current',
          targetValuation.analysisDate = '2026-03-10'
      MERGE (target)-[:HAS_VALUATION]->(targetValuation)

      WITH 1 AS _
      MATCH (peer:Case {caseId: 'CASE-PEER-1'})
      MATCH (peerDoc:Document {sourceId: 'doc:peer:medical:1'})
      SET peer.clientAge = 31, peer.workAccidentFlag = true
      MERGE (peerChunk:DocumentChunk {chunkId: 'doc:peer:medical:1:chunk:1'})
      SET peerChunk.documentId = peerDoc.sourceId,
          peerChunk.caseId = peer.caseId,
          peerChunk.chunkNumber = 1,
          peerChunk.pageRange = '1',
          peerChunk.text = 'נקבעה נכות קבועה בשיעור 10% לאחר תאונת עבודה. קיימת ירידה בהכנסה.',
          peerChunk.textPreview = 'נקבעה נכות קבועה בשיעור 10% לאחר תאונת עבודה.',
          peerChunk.summary = 'Permanent disability and work accident',
          peerChunk.gcsUri = 'gs://test/peer.pdf',
          peerChunk.charCount = 90,
          peerChunk.source = 'test'
      MERGE (peerDoc)-[:HAS_CHUNK]->(peerChunk)
      MERGE (peerDisability:EvidenceFact {factId: 'fact:peer:disability'})
      SET peerDisability.caseId = peer.caseId,
          peerDisability.documentId = peerDoc.sourceId,
          peerDisability.chunkId = peerChunk.chunkId,
          peerDisability.kind = 'disability_period',
          peerDisability.subtype = 'permanent',
          peerDisability.label = 'Disability permanent: 10%',
          peerDisability.value = '10%',
          peerDisability.numericValue = 10,
          peerDisability.unit = 'percent',
          peerDisability.fromDate = '2026-02-01',
          peerDisability.toDate = null,
          peerDisability.observedDate = '2026-02-01',
          peerDisability.confidence = 0.9,
          peerDisability.quote = peerChunk.textPreview,
          peerDisability.metadata = '{}'
      MERGE (peer)-[:HAS_EVIDENCE_FACT]->(peerDisability)
      MERGE (peerDoc)-[:SUPPORTS_FACT]->(peerDisability)
      MERGE (peerChunk)-[:SUPPORTS_FACT]->(peerDisability)
      MERGE (peerValuation:CaseValuation {valuationId: 'valuation:peer:1'})
      SET peerValuation.caseId = peer.caseId,
          peerValuation.compensationMin = 140000,
          peerValuation.compensationMax = 220000,
          peerValuation.feeMin = 28000,
          peerValuation.feeMax = 44000,
          peerValuation.totalEstimate = 180000,
          peerValuation.basis = 'peer valuation',
          peerValuation.status = 'current',
          peerValuation.analysisDate = '2026-02-01'
      MERGE (peer)-[:HAS_VALUATION]->(peerValuation)
    `);
    await session.run('CALL db.awaitIndexes(30)');
  } finally {
    await session.close();
  }
}

after(async () => {
  if (hasNeo4j) {
    await closeNeo4j();
  }
});

test(
  'findCase resolves case numbers and similarity works without aiGeneratedSummary',
  { skip: !hasNeo4j },
  async () => {
    await resetFixture();
    const findResult = await findCaseTool.execute({ query: '20260001', limit: 5 });
    assert.equal(findResult.hits[0]?.caseId, 'CASE-TARGET');
    assert.equal(findResult.hits[0]?.sourceId, 'case-target');

    const bySourceId = await findCaseTool.execute({ query: 'case-target', limit: 5 });
    assert.equal(bySourceId.hits[0]?.caseId, 'CASE-TARGET');

    const overview = await getCaseOverviewTool.execute({ caseId: 'case-target' });
    assert.equal(overview.caseId, 'CASE-TARGET');

    const docs = await getCaseDocumentsTool.execute({ caseId: 'case-target', category: '', limit: 5 });
    assert.ok(docs.length > 0);

    const comms = await getCaseCommunicationsTool.execute({ caseId: 'case-target', limit: 5 });
    assert.ok(comms.length > 0);

    const similar = await findSimilarCasesTool.execute({
      caseId: 'case-target',
      targetStage: '',
      limit: 3,
    });
    assert.ok(similar.hits.length > 0);
    assert.ok(similar.hits[0]?.reasons.length);

    const decision = await runExplainReadinessDecision({
      question: 'When will case-target be ready for file_claim?',
      caseId: 'case-target',
      targetStage: 'file_claim',
    });
    assert.equal(decision.artifact.targetCase.caseId, 'CASE-TARGET');
  }
);

test(
  'rankCasesByStageTransitionTime uses explicit transition timing',
  { skip: !hasNeo4j },
  async () => {
    await resetFixture();
    const result = await rankCasesByStageTransitionTimeTool.execute({
      targetStage: 'file_claim',
      limit: 5,
    });

    assert.ok(result.hits.length > 0);
    assert.equal(result.hits[0]?.timingSource, 'activity_log');
    assert.equal(typeof result.hits[0]?.daysFromEventToStage, 'number');
    assert.ok(result.excludedMissingTimingCount >= 0);
  }
);

test(
  'sparse stage readiness returns structured low-confidence fallback instead of tool errors',
  { skip: !hasNeo4j },
  async () => {
    await resetSparseFixture();

    const ranked = await rankCasesByStageTransitionTimeTool.execute({
      targetStage: 'file_claim',
      limit: 5,
    });
    assert.equal(ranked.hits.length, 1);
    assert.equal(ranked.hits[0]?.caseId, 'SPARSE-PEER');
    assert.equal(ranked.hits[0]?.timingSource, 'activity_log');
    assert.ok(ranked.meta.cypher.includes('REACHED_STAGE'));

    const pattern = await runDeriveReadinessPattern({
      caseId: 'SPARSE-TARGET',
      targetStage: 'file_claim',
    });
    assert.equal(pattern.availability, 'sparse_stage');
    assert.equal(pattern.cohortAvailable, false);
    assert.equal(pattern.historicalPeerCount, 1);
    assert.deepEqual(pattern.observedCommonSignals, []);

    const comparison = await runCompareCaseToReadinessPattern({
      caseId: 'SPARSE-TARGET',
      targetStage: 'file_claim',
    });
    assert.equal(comparison.availability, 'sparse_stage');
    assert.equal(comparison.weightedCoverage, 0);
    assert.deepEqual(comparison.missingSignals, []);

    const estimate = await runEstimateTimeToStage({
      caseId: 'SPARSE-TARGET',
      targetStage: 'file_claim',
    });
    assert.equal(estimate.availability, 'sparse_stage');
    assert.equal(estimate.cohortAvailable, false);
    assert.equal(estimate.historicalPeerCount, 1);
    assert.equal(estimate.estimationBasis, 'stage_timing_fallback');
    assert.equal(estimate.confidence, 'low');
    assert.deepEqual(estimate.comparableCaseIds, ['SPARSE-PEER']);
    assert.ok(estimate.timingSources.some((source) => source.timingSource === 'activity_log'));
    assert.ok(estimate.uncertaintyReasons.some((reason) => reason.includes('only 1 timed historical peer')));
    assert.ok(estimate.meta.cypher.includes('REACHED_STAGE'));
  }
);

test(
  'historical cohort tools expose observed common signals and matched/missing signals',
  { skip: !hasNeo4j },
  async () => {
    await resetFixture();
    const pattern = await runDeriveReadinessPattern({
      caseId: 'CASE-TARGET',
      targetStage: 'file_claim',
    });
    assert.equal(pattern.cohortSize, 12);
    assert.ok(pattern.observedCommonSignals.some((signal) => signal.signalKey === 'documentCategory:evidence'));

    const comparison = await runCompareCaseToReadinessPattern({
      caseId: 'CASE-TARGET',
      targetStage: 'file_claim',
    });
    assert.ok(comparison.weightedCoverage > 0);
    assert.ok(comparison.matchedSignals.some((signal) => signal.signalKey === 'documentCategory:medical'));
    assert.ok(comparison.missingSignals.some((signal) => signal.signalKey === 'documentCategory:evidence'));

    const decision = await runExplainReadinessDecision({
      question: 'When will CASE-TARGET be ready for file_claim?',
      caseId: 'CASE-TARGET',
      targetStage: 'file_claim',
    });
    assert.equal(decision.artifact.cohortSize, 12);
    assert.ok(decision.artifact.observedCommonSignals.length > 0);
    assert.ok(decision.artifact.missingSignals.length > 0);
    assert.notEqual(decision.artifact.timelineEstimate.timingStatus, undefined);
    assert.ok((decision.artifact.timelineEstimate.remainingDaysMedian ?? 0) >= 0);
  }
);

test(
  'case evidence references stable document source IDs',
  { skip: !hasNeo4j },
  async () => {
    await resetFixture();
    const result = await getCaseEvidenceTool.execute({ caseId: 'CASE-TARGET' });
    const evidence = getCaseEvidenceTool.extractEvidence(result);

    assert.equal(evidence[0]?.sourceId, 'doc:target:medical');
    assert.equal(evidence[0]?.label, 'medical: Dana medical report');
  }
);

test(
  'analytics replacement rolls back when transaction fails',
  { skip: !hasNeo4j },
  async () => {
    await resetFixture();
    const signalCount = await countNodes('ReadinessSignal');
    const cohortCount = await countNodes('ReadinessCohort');
    const emptySignals: SignalWriteSet = {
      signalDefs: [],
      caseSignalRows: [],
      documentEmitRows: [],
      communicationEmitRows: [],
      activityEmitRows: [],
    };
    const emptyCohorts: CohortWriteSet = { cohortRows: [], memberRows: [], signalRows: [] };
    const session = createSession();

    try {
      await assert.rejects(() =>
        session.executeWrite(async (tx) => {
          await persistSignalWriteSet(tx, emptySignals);
          await persistCohortWriteSet(tx, emptyCohorts);
          throw new Error('forced rollback');
        })
      );
    } finally {
      await session.close();
    }

    assert.equal(await countNodes('ReadinessSignal'), signalCount);
    assert.equal(await countNodes('ReadinessCohort'), cohortCount);
  }
);

test(
  'estimateTimeToStage returns uncertainty when target case lacks eventDate',
  { skip: !hasNeo4j },
  async () => {
    await resetFixture();
    const estimate = await runEstimateTimeToStage({
      caseId: 'CASE-NODATE',
      targetStage: 'file_claim',
    });
    assert.equal(estimate.timingStatus, 'no_estimate');
    assert.equal(estimate.remainingDaysMedian, null);
    assert.ok(estimate.uncertaintyReasons.some((reason) => reason.includes('eventDate')));
  }
);

test(
  'OCR evidence and value tools retrieve graph-grounded document substance',
  { skip: !hasNeo4j },
  async () => {
    await resetFixture();
    await seedOcrValueFixture();

    const evidence = await searchDocumentEvidenceTool.execute({
      query: 'תקנה 15 נכות',
      caseId: 'CASE-TARGET',
      limit: 5,
    });
    assert.equal(evidence.status, 'ok');
    assert.ok(evidence.hits.some((hit) => hit.snippet.includes('תקנה 15')));

    const facts = await getCaseDocumentFactsTool.execute({
      caseId: 'CASE-TARGET',
      factKinds: ['disability_period', 'income_evidence'],
      limit: 10,
    });
    assert.equal(facts.status, 'ok');
    assert.ok(facts.facts.some((fact) => fact.kind === 'disability_period' && fact.numericValue === 40));

    const comparables = await findComparableCasesByFactsTool.execute({
      caseType: 'car_accident_minor',
      workAccidentFlag: true,
      ageMin: 25,
      ageMax: 35,
      disabilityPercentMin: 5,
      disabilityPercentMax: 45,
      limit: 5,
    });
    assert.equal(comparables.status, 'ok');
    assert.ok(comparables.hits.some((hit) => hit.caseId === 'CASE-PEER-1'));
    assert.ok(comparables.hits.some((hit) => hit.valuation !== null));

    const value = await getCaseValueContextTool.execute({
      caseId: 'CASE-TARGET',
      caseType: 'car_accident_minor',
      workAccidentFlag: true,
      ageMin: 25,
      ageMax: 35,
      disabilityPercentMin: 5,
      disabilityPercentMax: 45,
      targetQuestion: 'כמה שווה התיק?',
      limit: 5,
    });
    assert.equal(value.status, 'ok');
    assert.equal(value.targetValuation?.totalEstimate, 125000);
    assert.ok((value.rangeSummary.compensationMax ?? 0) >= 150000);

    const insufficient = await getCaseValueContextTool.execute({
      caseType: 'medical_negligence',
      workAccidentFlag: true,
      disabilityPercentMin: 90,
      disabilityPercentMax: 100,
      limit: 5,
    });
    assert.equal(insufficient.status, 'insufficient_graph_evidence');
  }
);
