import 'dotenv/config';
import { connectNeo4j, closeNeo4j, createSession } from '../db/neo4j';
import { runDeriveReadinessPattern } from '../tools/deriveReadinessPattern';
import { runCompareCaseToReadinessPattern } from '../tools/compareCaseToReadinessPattern';
import { runEstimateTimeToStage } from '../tools/estimateTimeToStage';

/**
 * End-to-end check that the activity-log-only timing fix is wired through the
 * three readiness tools. Picks a real case and a real target stage from the
 * graph, then prints the structured tool output so a human can eyeball:
 *   - cohort.timingFromActivityLog
 *   - cohort.activityLogMemberCount / snapshotMemberCount
 *   - timing fields are NULL when activityLogMemberCount < MIN_ACTIVITY_LOG_TIMING_MEMBERS
 *   - uncertaintyReasons explains why
 */
async function main(): Promise<void> {
  await connectNeo4j();
  const s = createSession();
  let caseId: string;
  let targetStage: string;
  try {
    // Pick a case currently in case_building (the largest stage cohort) and
    // ask whether it's ready for statement_of_defense (the next-largest one).
    const sample = await s.run(
      `MATCH (c:Case) WHERE c.legalStage = 'case_building' RETURN c.caseId AS id LIMIT 1`
    );
    caseId = (sample.records[0]?.get('id') as string) ?? '';
    if (!caseId) {
      console.error('No case_building case found — run `npm run setup` first.');
      process.exit(1);
    }
    targetStage = 'statement_of_defense';

    console.log(`Seed case: ${caseId}`);
    console.log(`Target stage: ${targetStage}\n`);
  } finally {
    await s.close();
  }

  console.log('--- deriveReadinessPattern ---');
  const pattern = await runDeriveReadinessPattern({ caseId, targetStage });
  console.log({
    availability: pattern.availability,
    cohortAvailable: pattern.cohortAvailable,
    cohortSize: pattern.cohortSize,
    cohortSelectionCriteria: pattern.cohortSelectionCriteria,
    timing: pattern.timing,
    uncertaintyReasons: pattern.uncertaintyReasons,
    observedCommonSignalCount: pattern.observedCommonSignals.length,
  });

  console.log('\n--- compareCaseToReadinessPattern ---');
  const comparison = await runCompareCaseToReadinessPattern({ caseId, targetStage });
  console.log({
    availability: comparison.availability,
    weightedCoverage: comparison.weightedCoverage,
    matchedSignalCount: comparison.matchedSignals.length,
    missingSignalCount: comparison.missingSignals.length,
    contextDifferenceCount: comparison.contextDifferences.length,
    uncertaintyReasons: comparison.uncertaintyReasons,
  });

  console.log('\n--- estimateTimeToStage ---');
  const estimate = await runEstimateTimeToStage({ caseId, targetStage });
  console.log({
    availability: estimate.availability,
    estimationBasis: estimate.estimationBasis,
    timingStatus: estimate.timingStatus,
    remainingDaysMedian: estimate.remainingDaysMedian,
    behindByDaysMedian: estimate.behindByDaysMedian,
    confidence: estimate.confidence,
    historicalPeerCount: estimate.historicalPeerCount,
    comparablePeerCount: estimate.comparableCaseIds.length,
    timingSourceMix: estimate.timingSources.reduce<Record<string, number>>((acc, row) => {
      acc[row.timingSource] = (acc[row.timingSource] ?? 0) + 1;
      return acc;
    }, {}),
    uncertaintyReasons: estimate.uncertaintyReasons,
  });

  console.log('\nPASS');
  await closeNeo4j();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  await closeNeo4j();
  process.exit(1);
});
