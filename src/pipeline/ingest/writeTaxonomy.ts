import type { Session } from 'neo4j-driver';
import type { CaseNode } from '../../types/graph.types';
import { dedupeByKey, type InjuryRow, type BodyPartRow, type InsurerRow, type ExpertRow } from './extract';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Ingest');

export async function writeStages(session: Session, caseNodes: CaseNode[]): Promise<void> {
  logger.log('\nWriting Stage nodes + IN_STAGE edges');
  const stageRows = Array.from(
    new Set(caseNodes.map((n) => n.legalStage).filter(Boolean))
  ).map((name) => ({ name }));
  await session.run(`UNWIND $rows AS row MERGE (s:Stage {name: row.name})`, { rows: stageRows });
  const result = await session.run(`
    MATCH (c:Case), (s:Stage {name: c.legalStage})
    MERGE (c)-[:IN_STAGE]->(s)
    RETURN count(*) AS edges
  `);
  const edges = result.records[0]?.get('edges');
  logger.log(`Wrote ${stageRows.length} Stages, ${edges?.toNumber?.() ?? edges ?? 0} IN_STAGE edges`);
}

export async function writeInjuriesAndBodyParts(
  session: Session,
  injuryRows: InjuryRow[],
  bodyPartRows: BodyPartRow[]
): Promise<void> {
  logger.log('\nWriting Injury / BodyPart nodes + edges');
  const uniqueInjuries = dedupeByKey(
    injuryRows.map((r) => ({ name: r.name, normalized: r.normalized })),
    (x) => x.normalized
  );
  await session.run(
    `UNWIND $rows AS row
     MERGE (i:Injury {normalized: row.normalized})
     SET i.name = row.name`,
    { rows: uniqueInjuries }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (i:Injury {normalized: row.normalized})
     MERGE (c)-[r:HAS_INJURY]->(i)
     SET r.status = row.status`,
    { rows: injuryRows }
  );

  const uniqueBodyParts = dedupeByKey(
    bodyPartRows.map((r) => ({ name: r.name, normalized: r.normalized })),
    (x) => x.normalized
  );
  await session.run(
    `UNWIND $rows AS row
     MERGE (b:BodyPart {normalized: row.normalized})
     SET b.name = row.name`,
    { rows: uniqueBodyParts }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (b:BodyPart {normalized: row.normalized})
     MERGE (c)-[:AFFECTS_BODY_PART]->(b)`,
    { rows: bodyPartRows }
  );

  logger.log(
    `Wrote ${uniqueInjuries.length} Injuries, ${uniqueBodyParts.length} BodyParts, ${injuryRows.length} HAS_INJURY, ${bodyPartRows.length} AFFECTS_BODY_PART (case)`
  );
}

export async function writeInsurers(session: Session, insurerRows: InsurerRow[]): Promise<void> {
  logger.log('\nWriting InsuranceCompany nodes + AGAINST_INSURER edges');
  const unique = dedupeByKey(
    insurerRows.map((r) => ({ name: r.name, normalized: r.normalized })),
    (x) => x.normalized
  );
  await session.run(
    `UNWIND $rows AS row
     MERGE (ic:InsuranceCompany {normalized: row.normalized})
     SET ic.name = row.name`,
    { rows: unique }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (ic:InsuranceCompany {normalized: row.normalized})
     MERGE (c)-[:AGAINST_INSURER]->(ic)`,
    { rows: insurerRows }
  );
  logger.log(`Wrote ${unique.length} Insurers, ${insurerRows.length} AGAINST_INSURER edges`);
}

export async function writeExperts(session: Session, expertRows: ExpertRow[]): Promise<void> {
  logger.log('\nWriting Expert nodes + OUR_EXPERT/COURT_EXPERT edges');
  const unique = dedupeByKey(expertRows, (r) => r.key).map((r) => ({
    key: r.key,
    name: r.name,
    normalized: r.normalized,
    specialty: r.specialty,
  }));
  await session.run(
    `UNWIND $rows AS row
     MERGE (e:Expert {key: row.key})
     SET e.name = row.name, e.normalized = row.normalized, e.specialty = row.specialty`,
    { rows: unique }
  );
  const ours = expertRows.filter((r) => r.side === 'ours');
  const court = expertRows.filter((r) => r.side === 'court');
  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (e:Expert {key: row.key})
     MERGE (c)-[:OUR_EXPERT]->(e)`,
    { rows: ours }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (e:Expert {key: row.key})
     MERGE (c)-[:COURT_EXPERT]->(e)`,
    { rows: court }
  );
  logger.log(`Wrote ${unique.length} Experts, ${ours.length} OUR_EXPERT, ${court.length} COURT_EXPERT edges`);
}
