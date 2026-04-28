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
    const emptyCohorts: CohortWriteSet = { cohortRows: [], memberRows: [], signalRows: [], weakSignalRows: [] };
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
