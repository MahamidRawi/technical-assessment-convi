import 'dotenv/config';
import { connectNeo4j, closeNeo4j } from '../db/neo4j';

const NODE_LABELS = [
  'Case',
  'Contact',
  'Document',
  'Communication',
  'Stage',
  'StageEvent',
  'ActivityEvent',
  'Injury',
  'BodyPart',
  'InsuranceCompany',
  'Expert',
  'DocumentCategory',
  'DocumentType',
  'ReadinessSignal',
  'ReadinessCohort',
  'DocumentChunk',
  'EvidenceFact',
  'CaseValuation',
  'DamageComponent',
] as const;

const RELATIONSHIPS = [
  'HAS_CLIENT',
  'HAS_CONTACT',
  'HAS_DOCUMENT',
  'HAS_COMMUNICATION',
  'HAS_ACTIVITY',
  'HAS_STAGE_EVENT',
  'REACHED_STAGE',
  'IN_STAGE',
  'FOR_STAGE',
  'HAS_INJURY',
  'AFFECTS_BODY_PART',
  'AGAINST_INSURER',
  'OUR_EXPERT',
  'COURT_EXPERT',
  'OF_CATEGORY',
  'OF_TYPE',
  'DERIVED_FROM',
  'FROM_CONTACT',
  'TO_CONTACT',
  'CC_CONTACT',
  'EMITS_SIGNAL',
  'HAS_SIGNAL',
  'COMMON_SIGNAL',
  'HAS_MEMBER',
  'TARGET_STAGE',
  'SIMILAR_TO',
  'HAS_CHUNK',
  'SUPPORTS_FACT',
  'HAS_EVIDENCE_FACT',
  'HAS_VALUATION',
  'HAS_COMPONENT',
] as const;

function num(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const obj = value as { toNumber?: () => number };
  return typeof obj.toNumber === 'function' ? obj.toNumber() : Number(value);
}

function pad(label: string, width: number): string {
  return label + ' '.repeat(Math.max(0, width - label.length));
}

async function main(): Promise<void> {
  const driver = await connectNeo4j();
  const s = driver.session();
  try {
    console.log('=== Node counts by label ===');
    for (const label of NODE_LABELS) {
      const r = await s.run(`MATCH (n:${label}) RETURN count(n) AS n`);
      console.log(`  ${pad(label, 20)} ${num(r.records[0]?.get('n'))}`);
    }

    console.log('\n=== Relationship counts by type ===');
    for (const rel of RELATIONSHIPS) {
      const r = await s.run(`MATCH ()-[x:${rel}]->() RETURN count(x) AS n`);
      console.log(`  ${pad(rel, 20)} ${num(r.records[0]?.get('n'))}`);
    }

    console.log('\n=== StageEvent source distribution ===');
    const sourceRows = await s.run(`
      MATCH (se:StageEvent)
      RETURN coalesce(se.source, 'unknown') AS source, count(*) AS n
      ORDER BY n DESC
    `);
    for (const r of sourceRows.records) {
      console.log(`  ${pad(String(r.get('source')), 30)} ${num(r.get('n'))}`);
    }

    console.log('\n=== Cases per stage (with reach source breakdown) ===');
    const stageRows = await s.run(`
      MATCH (c:Case)-[:HAS_STAGE_EVENT]->(se:StageEvent)-[:FOR_STAGE]->(s:Stage)
      WITH s.name AS stage,
           count(DISTINCT c) AS cases,
           sum(CASE WHEN se.source = 'activity_log' THEN 1 ELSE 0 END) AS activityLog,
           sum(CASE WHEN se.source <> 'activity_log' THEN 1 ELSE 0 END) AS snapshot
      RETURN stage, cases, activityLog, snapshot
      ORDER BY cases DESC, stage ASC
    `);
    for (const r of stageRows.records) {
      console.log(
        `  ${pad(String(r.get('stage')), 30)} cases=${num(r.get('cases'))}  activity_log=${num(r.get('activityLog'))}  snapshot=${num(r.get('snapshot'))}`
      );
    }

    console.log('\n=== Cohorts with timing-source provenance ===');
    const cohorts = await s.run(`
      MATCH (rc:ReadinessCohort)
      RETURN rc.scope AS scope,
             rc.caseType AS caseType,
             rc.targetStage AS stage,
             rc.memberCount AS members,
             coalesce(rc.activityLogMemberCount, 0) AS al,
             coalesce(rc.snapshotMemberCount, rc.memberCount) AS snap,
             rc.confidence AS confidence,
             coalesce(rc.timingFromActivityLog, false) AS timed,
             rc.medianDaysToStage AS median,
             rc.daysToStageP25 AS p25,
             rc.daysToStageP75 AS p75
      ORDER BY rc.memberCount DESC, rc.targetStage ASC
    `);
    if (cohorts.records.length === 0) {
      console.log('  (no cohorts formed — dataset has no stage with >= MIN_COHORT_SIZE members)');
    }
    for (const r of cohorts.records) {
      const median = r.get('median');
      const p25 = r.get('p25');
      const p75 = r.get('p75');
      const timingLabel = r.get('timed')
        ? `median=${num(median)}d p25=${num(p25)} p75=${num(p75)}`
        : 'timing=NULL (snapshot-only)';
      console.log(
        `  ${pad(String(r.get('stage')), 28)} scope=${r.get('scope')}  type=${r.get('caseType') ?? '(any)'}  members=${num(r.get('members'))} (al=${num(r.get('al'))}/snap=${num(r.get('snap'))})  conf=${r.get('confidence')}  ${timingLabel}`
      );
    }

    console.log('\n=== Top common signals per cohort (by weight) ===');
    const sigs = await s.run(`
      MATCH (rc:ReadinessCohort)-[cs:COMMON_SIGNAL]->(rs:ReadinessSignal)
      WITH rc, cs, rs
      ORDER BY cs.weight DESC
      RETURN rc.targetStage AS stage,
             rc.scope AS scope,
             rs.key AS signal,
             cs.support AS support,
             cs.lift AS lift,
             cs.medianLeadDays AS leadDays
      ORDER BY rc.targetStage, cs.weight DESC
      LIMIT 30
    `);
    for (const r of sigs.records) {
      const support = r.get('support');
      const lift = r.get('lift');
      const lead = r.get('leadDays');
      const fmt = (v: unknown, d = 2): string => {
        if (v == null) return 'n/a';
        const n = typeof v === 'number' ? v : (v as { toNumber?: () => number }).toNumber?.();
        return typeof n === 'number' ? n.toFixed(d) : 'n/a';
      };
      console.log(
        `  [${r.get('stage')}/${r.get('scope')}] ${r.get('signal')}  support=${fmt(support)} lift=${fmt(lift)} lead=${lead == null ? 'n/a' : `${num(lead)}d`}`
      );
    }

    console.log('\n=== OCR facts by kind ===');
    const factRows = await s.run(`
      MATCH (fact:EvidenceFact)
      RETURN fact.kind AS kind, count(*) AS n
      ORDER BY n DESC, kind ASC
    `);
    if (factRows.records.length === 0) {
      console.log('  (no OCR-derived facts)');
    }
    for (const r of factRows.records) {
      console.log(`  ${pad(String(r.get('kind')), 26)} ${num(r.get('n'))}`);
    }

    console.log('\n=== OCR / valuation index status ===');
    const indexRows = await s.run(`
      SHOW INDEXES
      YIELD name, type, labelsOrTypes, properties, state
      WHERE name IN ['documentChunkFulltext', 'evidenceFactFulltext']
         OR any(label IN labelsOrTypes WHERE label IN ['DocumentChunk', 'EvidenceFact', 'CaseValuation'])
      RETURN name, type, labelsOrTypes, properties, state
      ORDER BY name
    `);
    for (const r of indexRows.records) {
      console.log(
        `  ${pad(String(r.get('name')), 28)} type=${r.get('type')} labels=${JSON.stringify(r.get('labelsOrTypes'))} props=${JSON.stringify(r.get('properties'))} state=${r.get('state')}`
      );
    }

    console.log('\n=== Sample OCR-backed evidence paths ===');
    const evidenceRows = await s.run(`
      MATCH (c:Case)-[:HAS_DOCUMENT]->(doc:Document)-[:HAS_CHUNK]->(chunk:DocumentChunk)-[:SUPPORTS_FACT]->(fact:EvidenceFact)
      RETURN c.caseId AS caseId,
             doc.fileName AS fileName,
             chunk.chunkId AS chunkId,
             fact.kind AS kind,
             fact.label AS label
      ORDER BY fact.confidence DESC
      LIMIT 5
    `);
    if (evidenceRows.records.length === 0) {
      console.log('  (no document chunk -> fact paths)');
    }
    for (const r of evidenceRows.records) {
      console.log(
        `  ${r.get('caseId')} | ${r.get('kind')} | ${r.get('label')} | ${r.get('fileName')} | ${r.get('chunkId')}`
      );
    }

    console.log('\n=== Node samples (1 of each label, for spot inspection) ===');
    for (const label of NODE_LABELS) {
      const r = await s.run(`MATCH (n:${label}) RETURN n LIMIT 1`);
      const node = r.records[0]?.get('n');
      if (!node) {
        console.log(`  ${label}: (none)`);
        continue;
      }
      const props = (node as { properties?: Record<string, unknown> }).properties ?? {};
      const keys = Object.keys(props).slice(0, 6).join(', ');
      console.log(`  ${pad(label, 20)} keys: ${keys}${Object.keys(props).length > 6 ? ', ...' : ''}`);
    }

    console.log('\nPASS');
  } finally {
    await s.close();
    await closeNeo4j();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
