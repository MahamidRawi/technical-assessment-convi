import 'dotenv/config';
import { connectNeo4j, closeNeo4j } from '../db/neo4j';

async function main(): Promise<void> {
  const driver = await connectNeo4j();
  const s = driver.session();
  try {
    const checks: Array<[string, string]> = [
      ['Cohort nodes', 'MATCH (c:ReadinessCohort) RETURN count(c) AS n'],
      ['HAS_MEMBER rels', 'MATCH ()-[r:HAS_MEMBER]->() RETURN count(r) AS n'],
      ['COMMON_SIGNAL rels', 'MATCH ()-[r:COMMON_SIGNAL]->() RETURN count(r) AS n'],
      ['StageEvent nodes', 'MATCH (n:StageEvent) RETURN count(n) AS n'],
      ['REACHED_STAGE rels', 'MATCH ()-[r:REACHED_STAGE]->() RETURN count(r) AS n'],
    ];
    for (const [label, cypher] of checks) {
      const r = await s.run(cypher);
      console.log(`${label}: ${r.records[0]?.get('n')?.toNumber?.() ?? 0}`);
    }

    console.log('\nCohort breakdown:');
    const cohorts = await s.run(`
      MATCH (rc:ReadinessCohort)
      RETURN rc.key AS key,
             rc.targetStage AS stage,
             rc.scope AS scope,
             rc.caseType AS caseType,
             rc.memberCount AS members,
             coalesce(rc.activityLogMemberCount, 0) AS activityLog,
             coalesce(rc.snapshotMemberCount, rc.memberCount) AS snapshot,
             rc.confidence AS confidence,
             coalesce(rc.timingFromActivityLog, false) AS timingFromActivityLog,
             rc.medianDaysToStage AS medianDays,
             rc.daysToStageP25 AS p25,
             rc.daysToStageP75 AS p75
      ORDER BY rc.memberCount DESC
    `);
    const num = (v: unknown): string => {
      if (v == null) return 'n/a';
      if (typeof v === 'number') return String(v);
      const obj = v as { toNumber?: () => number };
      return typeof obj.toNumber === 'function' ? String(obj.toNumber()) : String(v);
    };
    for (const r of cohorts.records) {
      const timed = r.get('timingFromActivityLog');
      const timingLabel = timed
        ? `median=${num(r.get('medianDays'))}d (p25=${num(r.get('p25'))}, p75=${num(r.get('p75'))})`
        : 'timing=NULL (snapshot-only members)';
      console.log(
        `  ${r.get('stage')} | scope=${r.get('scope')} | caseType=${
          r.get('caseType') ?? '(any)'
        } | members=${num(r.get('members'))} (activity_log=${num(r.get('activityLog'))}/snapshot=${num(r.get('snapshot'))}) | confidence=${r.get('confidence') ?? '(none)'} | ${timingLabel}`
      );
    }

    console.log('\nCommon signals per cohort:');
    const sigs = await s.run(`
      MATCH (rc:ReadinessCohort)-[cs:COMMON_SIGNAL]->(rs:ReadinessSignal)
      RETURN rc.targetStage AS stage,
             rc.scope AS scope,
             rs.key AS signal,
             cs.support AS support,
             cs.lift AS lift,
             cs.medianLeadDays AS leadDays
      ORDER BY rc.targetStage, cs.weight DESC
    `);
    const fxd = (v: unknown, d = 2): string => {
      if (v == null) return 'n/a';
      const n = typeof v === 'number' ? v : (v as { toNumber?: () => number }).toNumber?.();
      return typeof n === 'number' ? n.toFixed(d) : 'n/a';
    };
    for (const r of sigs.records) {
      console.log(
        `  [${r.get('stage')} ${r.get('scope')}] ${r.get('signal')} | support=${fxd(
          r.get('support')
        )} | lift=${fxd(r.get('lift'))} | lead=${num(r.get('leadDays'))}d`
      );
    }
  } finally {
    await s.close();
    await closeNeo4j();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
