import type { Session } from 'neo4j-driver';
import { z } from 'zod';
import {
  neo4jNullableString,
  neo4jNumber,
  neo4jString,
  neo4jStringArray,
} from '@/tools/_shared/neo4jMap';
import { parseNeo4jRecords } from '../analytics/neo4jRows';
import type { CaseSignals } from './types';

const caseSignalRowSchema = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseType: neo4jString,
  legalStage: neo4jString,
  completionRate: neo4jNumber,
  aiGeneratedSummary: neo4jNullableString,
  injuries: neo4jStringArray,
  bodyParts: neo4jStringArray,
  insurers: neo4jStringArray,
  documentCategories: neo4jStringArray,
  documentTypes: neo4jStringArray,
  signalRows: z.array(
    z.object({
      key: neo4jNullableString,
      label: neo4jNullableString,
    })
  ),
});

const LOAD_CASES_CYPHER = `
  MATCH (c:Case)
  OPTIONAL MATCH (c)-[:HAS_SIGNAL]->(rs:ReadinessSignal)
  OPTIONAL MATCH (c)-[:HAS_INJURY]->(i:Injury)
  OPTIONAL MATCH (c)-[:AFFECTS_BODY_PART]->(bp:BodyPart)
  OPTIONAL MATCH (c)-[:AGAINST_INSURER]->(ins:InsuranceCompany)
  OPTIONAL MATCH (c)-[:HAS_DOCUMENT]->(d:Document)-[:OF_CATEGORY]->(dc:DocumentCategory)
  OPTIONAL MATCH (d)-[:OF_TYPE]->(dt:DocumentType)
  RETURN c.caseId AS caseId,
         c.caseName AS caseName,
         c.caseType AS caseType,
         c.legalStage AS legalStage,
         c.completionRate AS completionRate,
         c.aiGeneratedSummary AS aiGeneratedSummary,
         collect(DISTINCT i.normalized) AS injuries,
         collect(DISTINCT bp.normalized) AS bodyParts,
         collect(DISTINCT ins.normalized) AS insurers,
         collect(DISTINCT dc.name) AS documentCategories,
         collect(DISTINCT dt.name) AS documentTypes,
         collect(DISTINCT {key: rs.key, label: rs.label}) AS signalRows
`;

export async function loadCaseSignals(session: Session): Promise<CaseSignals[]> {
  const result = await session.run(LOAD_CASES_CYPHER);
  return parseNeo4jRecords(result.records, caseSignalRowSchema, 'similarity cases').map((row) => ({
    caseId: row.caseId,
    caseName: row.caseName,
    caseType: row.caseType,
    legalStage: row.legalStage,
    completionRate: row.completionRate,
    aiGeneratedSummary: row.aiGeneratedSummary,
    injuries: row.injuries.filter(Boolean),
    bodyParts: row.bodyParts.filter(Boolean),
    insurers: row.insurers.filter(Boolean),
    documentCategories: row.documentCategories.filter(Boolean),
    documentTypes: row.documentTypes.filter(Boolean),
    signals: new Map(
      row.signalRows
        .filter((signal): signal is { key: string; label: string } =>
          Boolean(signal.key && signal.label)
        )
        .map((signal) => [signal.key, signal.label])
    ),
    embedding: null,
  }));
}
