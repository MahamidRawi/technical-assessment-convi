import { z } from 'zod';
import { neo4jNullableString, neo4jString, neo4jStringArray } from '@/tools/_shared/neo4jMap';
import { parseNeo4jRecords } from '../neo4jRows';
import { toIso } from './dates';
import type { CypherReadRunner, SignalObservation } from './types';

const documentSignalRowSchema = z.object({
  caseId: neo4jString,
  sourceId: neo4jString,
  observedAt: neo4jNullableString,
  categoryName: neo4jNullableString,
  typeName: neo4jNullableString,
});

const communicationSignalRowSchema = z.object({
  caseId: neo4jString,
  sourceId: neo4jString,
  observedAt: neo4jNullableString,
  direction: neo4jNullableString,
  relType: neo4jNullableString,
  contactType: neo4jNullableString,
});

const activitySignalRowSchema = z.object({
  caseId: neo4jString,
  sourceId: neo4jString,
  observedAt: neo4jNullableString,
  category: neo4jNullableString,
  action: neo4jNullableString,
});

const caseSignalRowSchema = z.object({
  caseId: neo4jString,
  caseType: neo4jString,
  createdAt: neo4jNullableString,
  eventDate: neo4jNullableString,
  injuries: neo4jStringArray,
  bodyParts: neo4jStringArray,
  insurers: neo4jStringArray,
  contactRoles: neo4jStringArray,
});

function documentObservations(
  rows: Array<z.output<typeof documentSignalRowSchema>>
): SignalObservation[] {
  return rows.flatMap((row): SignalObservation[] => {
    const observedAt = toIso(row.observedAt);
    const base = {
      caseId: row.caseId,
      observedAt,
      sourceKind: 'document',
      emitLabel: 'Document' as const,
      emitSourceId: row.sourceId,
    };
    const observations: SignalObservation[] = [];
    if (row.categoryName) {
      observations.push({
        ...base,
        key: `documentCategory:${row.categoryName}`,
        label: `Document category: ${row.categoryName}`,
        kind: 'documentCategory',
      });
    }
    if (row.typeName) {
      observations.push({
        ...base,
        key: `documentType:${row.typeName}`,
        label: `Document type: ${row.typeName}`,
        kind: 'documentType',
      });
    }
    return observations;
  });
}

function communicationObservations(
  rows: Array<z.output<typeof communicationSignalRowSchema>>
): SignalObservation[] {
  return rows.flatMap((row): SignalObservation[] => {
    const observedAt = toIso(row.observedAt);
    const base = {
      caseId: row.caseId,
      observedAt,
      sourceKind: 'communication',
      emitLabel: 'Communication' as const,
      emitSourceId: row.sourceId,
    };
    const observations: SignalObservation[] = [];
    if (row.direction) {
      observations.push({
        ...base,
        key: `communicationDirection:${row.direction}`,
        label: `Communication direction: ${row.direction}`,
        kind: 'communicationDirection',
      });
    }
    if (row.relType && row.contactType) {
      observations.push({
        ...base,
        key: `communicationParty:${row.relType}:${row.contactType}`,
        label: `${row.relType} ${row.contactType}`,
        kind: 'communicationParty',
      });
    }
    return observations;
  });
}

function activityObservations(
  rows: Array<z.output<typeof activitySignalRowSchema>>
): SignalObservation[] {
  return rows.flatMap((row) => {
    if (!row.action) return [];
    const key = row.category ? `activity:${row.category}:${row.action}` : `activity:${row.action}`;
    return [{
      caseId: row.caseId,
      key,
      label: row.category ? `${row.category}: ${row.action}` : row.action,
      kind: 'activity',
      observedAt: toIso(row.observedAt),
      sourceKind: 'activity',
      emitLabel: 'ActivityEvent',
      emitSourceId: row.sourceId,
    }];
  });
}

function caseObservations(rows: Array<z.output<typeof caseSignalRowSchema>>): SignalObservation[] {
  return rows.flatMap((row) => {
    const observedAt = toIso(row.createdAt) ?? toIso(row.eventDate);
    return [
    { key: `caseType:${row.caseType}`, label: `Case type: ${row.caseType}`, kind: 'caseType', value: row.caseType },
    ...row.injuries.map((value) => ({ key: `injury:${value}`, label: `Injury: ${value}`, kind: 'injury', value })),
    ...row.bodyParts.map((value) => ({ key: `bodyPart:${value}`, label: `Body part: ${value}`, kind: 'bodyPart', value })),
    ...row.insurers.map((value) => ({ key: `insurer:${value}`, label: `Insurer: ${value}`, kind: 'insurer', value })),
    ...row.contactRoles.map((value) => ({ key: `contactRole:${value}`, label: `Contact role: ${value}`, kind: 'contactRole', value })),
    ].filter((signal) => signal.value).map((signal) => ({
      caseId: row.caseId,
      key: signal.key,
      label: signal.label,
      kind: signal.kind,
      observedAt,
      sourceKind: signal.kind,
    }));
  });
}

export async function collectSignalObservations(session: CypherReadRunner): Promise<SignalObservation[]> {
  const docRows = await session.run(`
      MATCH (c:Case)-[:HAS_DOCUMENT]->(d:Document)
      OPTIONAL MATCH (d)-[:OF_CATEGORY]->(dc:DocumentCategory)
      OPTIONAL MATCH (d)-[:OF_TYPE]->(dt:DocumentType)
      RETURN c.caseId AS caseId, d.sourceId AS sourceId, toString(coalesce(d.documentDate, d.uploadedAt)) AS observedAt,
             dc.name AS categoryName, dt.name AS typeName
    `);
  const commRows = await session.run(`
      MATCH (c:Case)-[:HAS_COMMUNICATION]->(com:Communication)
      OPTIONAL MATCH (com)-[rel:FROM_CONTACT|TO_CONTACT|CC_CONTACT]->(con:Contact)
      RETURN c.caseId AS caseId, com.sourceId AS sourceId, toString(com.sentAt) AS observedAt,
             com.direction AS direction, type(rel) AS relType, con.contactType AS contactType
    `);
  const activityRows = await session.run(`
      MATCH (c:Case)-[:HAS_ACTIVITY]->(ae:ActivityEvent)
      RETURN c.caseId AS caseId, ae.sourceId AS sourceId, toString(ae.at) AS observedAt,
             ae.category AS category, ae.action AS action
      UNION
      MATCH (c:Case)-[:HAS_STAGE_EVENT]->(se:StageEvent)-[:FOR_STAGE]->(s:Stage)
      RETURN c.caseId AS caseId, se.key AS sourceId, toString(se.occurredAt) AS observedAt,
             'stage' AS category, s.name AS action
    `);
  const caseRows = await session.run(`
      MATCH (c:Case)
      OPTIONAL MATCH (c)-[:HAS_INJURY]->(i:Injury)
      OPTIONAL MATCH (c)-[:AFFECTS_BODY_PART]->(b:BodyPart)
      OPTIONAL MATCH (c)-[:AGAINST_INSURER]->(ins:InsuranceCompany)
      OPTIONAL MATCH (c)-[hc:HAS_CONTACT]->(con:Contact)
      RETURN c.caseId AS caseId, c.caseType AS caseType,
             toString(c.createdAt) AS createdAt,
             toString(c.eventDate) AS eventDate,
             collect(DISTINCT i.normalized) AS injuries,
             collect(DISTINCT b.normalized) AS bodyParts,
             collect(DISTINCT ins.normalized) AS insurers,
             collect(DISTINCT hc.role) AS contactRoles
    `);

  return [
    ...documentObservations(parseNeo4jRecords(docRows.records, documentSignalRowSchema, 'document signals')),
    ...communicationObservations(parseNeo4jRecords(commRows.records, communicationSignalRowSchema, 'communication signals')),
    ...activityObservations(parseNeo4jRecords(activityRows.records, activitySignalRowSchema, 'activity signals')),
    ...caseObservations(parseNeo4jRecords(caseRows.records, caseSignalRowSchema, 'case signals')),
  ];
}
