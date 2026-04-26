import 'dotenv/config';
import { connectNeo4j, closeNeo4j } from '../db/neo4j';

async function main(): Promise<void> {
  const driver = await connectNeo4j();
  const session = driver.session();
  const stage = 'file_claim';

  try {
    const stageExists = await session.run(
      `MATCH (s:Stage {name: $stage}) RETURN count(s) AS n`,
      { stage }
    );
    const stageCount = stageExists.records[0]?.get('n')?.toNumber?.() ?? 0;
    console.log(`Stage "${stage}" exists: ${stageCount > 0}`);

    const reachedAll = await session.run(
      `MATCH (c:Case)-[r:REACHED_STAGE]->(:Stage {name: $stage})
       RETURN count(DISTINCT c) AS n, count(r) AS rels`,
      { stage }
    );
    console.log(
      `Cases with REACHED_STAGE→file_claim: ${reachedAll.records[0]
        ?.get('n')
        ?.toNumber?.()} (relationships: ${reachedAll.records[0]?.get('rels')?.toNumber?.()})`
    );

    const inStageAll = await session.run(
      `MATCH (c:Case) WHERE c.legalStage = $stage RETURN count(c) AS n`,
      { stage }
    );
    console.log(
      `Cases with c.legalStage = "file_claim": ${inStageAll.records[0]
        ?.get('n')
        ?.toNumber?.()}`
    );

    const inStageWithEntered = await session.run(
      `MATCH (c:Case)
       WHERE c.legalStage = $stage AND c.legalStageEnteredAt IS NOT NULL
       RETURN count(c) AS n`,
      { stage }
    );
    console.log(
      `  ...of those, with legalStageEnteredAt: ${inStageWithEntered.records[0]
        ?.get('n')
        ?.toNumber?.()}`
    );

    const inStageWithEnteredAndEvent = await session.run(
      `MATCH (c:Case)
       WHERE c.legalStage = $stage
         AND c.legalStageEnteredAt IS NOT NULL
         AND c.eventDate IS NOT NULL
       RETURN count(c) AS n`,
      { stage }
    );
    console.log(
      `  ...AND with eventDate (would be timed): ${inStageWithEnteredAndEvent.records[0]
        ?.get('n')
        ?.toNumber?.()}`
    );

    const reachedWithEvent = await session.run(
      `MATCH (c:Case)-[r:REACHED_STAGE]->(:Stage {name: $stage})
       WHERE c.eventDate IS NOT NULL AND r.at IS NOT NULL
       RETURN count(DISTINCT c) AS n`,
      { stage }
    );
    console.log(
      `Cases with REACHED_STAGE timestamp AND eventDate: ${reachedWithEvent.records[0]
        ?.get('n')
        ?.toNumber?.()}`
    );

    console.log(`\n=== Full ranked list (rankCasesByStageTransitionTime equivalent) ===`);
    const ranked = await session.run(
      `
      MATCH (c:Case)
      OPTIONAL MATCH (c)-[r:REACHED_STAGE]->(:Stage {name: $stage})
      WITH c, min(r.at) AS reachedAt
      WHERE c.legalStage = $stage OR reachedAt IS NOT NULL
      WITH c,
           CASE
             WHEN reachedAt IS NOT NULL THEN reachedAt
             WHEN c.legalStage = $stage AND c.legalStageEnteredAt IS NOT NULL
               THEN datetime(c.legalStageEnteredAt)
             ELSE null
           END AS stageAt,
           CASE
             WHEN reachedAt IS NOT NULL THEN 'REACHED_STAGE'
             WHEN c.legalStage = $stage AND c.legalStageEnteredAt IS NOT NULL
               THEN 'legalStageEnteredAt'
             ELSE null
           END AS timingSource
      WITH c, stageAt, timingSource,
           CASE
             WHEN c.eventDate IS NOT NULL AND stageAt IS NOT NULL
               THEN duration.inDays(datetime(c.eventDate), stageAt).days
             ELSE null
           END AS daysFromEventToStage
      WHERE daysFromEventToStage IS NOT NULL
      RETURN c.caseId AS caseId,
             c.caseName AS caseName,
             c.eventDate AS eventDate,
             toString(stageAt) AS stageAt,
             daysFromEventToStage,
             timingSource
      ORDER BY daysFromEventToStage ASC, c.caseName ASC
      `,
      { stage }
    );
    console.log(`Total timed cases: ${ranked.records.length}`);
    for (const rec of ranked.records) {
      console.log(
        `  ${rec.get('caseId')} | ${rec.get('daysFromEventToStage')?.toNumber?.()} days | ` +
          `${rec.get('timingSource')} | event=${rec.get('eventDate')} | stageAt=${rec.get('stageAt')}`
      );
    }

    console.log(`\n=== Excluded (in scope but missing eventDate or stageAt) ===`);
    const excluded = await session.run(
      `
      MATCH (c:Case)
      OPTIONAL MATCH (c)-[r:REACHED_STAGE]->(:Stage {name: $stage})
      WITH c, min(r.at) AS reachedAt
      WHERE c.legalStage = $stage OR reachedAt IS NOT NULL
      WITH c, reachedAt,
           CASE
             WHEN reachedAt IS NOT NULL THEN reachedAt
             WHEN c.legalStage = $stage AND c.legalStageEnteredAt IS NOT NULL
               THEN datetime(c.legalStageEnteredAt)
             ELSE null
           END AS stageAt
      WHERE c.eventDate IS NULL OR stageAt IS NULL
      RETURN c.caseId AS caseId,
             c.caseName AS caseName,
             c.legalStage AS legalStage,
             c.eventDate AS eventDate,
             c.legalStageEnteredAt AS legalStageEnteredAt,
             reachedAt
      LIMIT 25
      `,
      { stage }
    );
    console.log(`Excluded count (showing up to 25): ${excluded.records.length}`);
    for (const rec of excluded.records) {
      console.log(
        `  ${rec.get('caseId')} | legalStage=${rec.get('legalStage')} | event=${rec.get(
          'eventDate'
        )} | enteredAt=${rec.get('legalStageEnteredAt')} | reachedAt=${rec.get('reachedAt')}`
      );
    }
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
