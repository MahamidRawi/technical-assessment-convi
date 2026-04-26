import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import { neo4jNullableString, neo4jNumber, neo4jString, neo4jStringArray } from './_shared/neo4jMap';
import { CaseNotFoundError, resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface CaseGraphContext {
  caseId: string;
  caseName: string;
  caseNumber: string | null;
  caseType: string;
  legalStage: string;
  subStage: string | null;
  clientName: string | null;
  insurers: string[];
  injuries: string[];
  bodyParts: string[];
  signalSnapshot: Array<{ kind: string; labels: string[] }>;
  counts: { documents: number; communications: number; activities: number; stageEvents: number };
  meta: QueryMeta;
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
});

const rowSchema = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseNumber: neo4jNullableString,
  caseType: neo4jString,
  legalStage: neo4jString,
  subStage: neo4jNullableString,
  clientName: neo4jNullableString,
  insurers: neo4jStringArray,
  injuries: neo4jStringArray,
  bodyParts: neo4jStringArray,
  signalRows: z.array(
    z.object({
      kind: neo4jString,
      label: neo4jString,
    })
  ),
  documentCount: neo4jNumber,
  communicationCount: neo4jNumber,
  activityCount: neo4jNumber,
  stageEventCount: neo4jNumber,
});

async function execute({ caseId }: z.infer<typeof inputSchema>): Promise<CaseGraphContext> {
  const canonicalCaseId = await resolveCaseId(caseId);
  const cypher = `
    MATCH (c:Case {caseId: $caseId})
    OPTIONAL MATCH (c)-[:HAS_CLIENT]->(client:Contact)
    WITH c, head(collect(client)) AS client
    OPTIONAL MATCH (c)-[:AGAINST_INSURER]->(ins:InsuranceCompany)
    WITH c, client, collect(DISTINCT ins.name) AS insurers
    OPTIONAL MATCH (c)-[:HAS_INJURY]->(inj:Injury)
    WITH c, client, insurers, collect(DISTINCT inj.name) AS injuries
    OPTIONAL MATCH (c)-[:AFFECTS_BODY_PART]->(bp:BodyPart)
    WITH c, client, insurers, injuries, collect(DISTINCT bp.name) AS bodyParts
    CALL {
      WITH c
      MATCH (c)-[:HAS_SIGNAL]->(rs:ReadinessSignal)
      RETURN collect({kind: rs.kind, label: rs.label}) AS rawSignals
    }
    WITH c, client, insurers, injuries, bodyParts, rawSignals,
         COUNT { (c)-[:HAS_DOCUMENT]->(:Document) } AS documentCount,
         COUNT { (c)-[:HAS_COMMUNICATION]->(:Communication) } AS communicationCount,
         COUNT { (c)-[:HAS_ACTIVITY]->(:ActivityEvent) } AS activityCount,
         COUNT { (c)-[:HAS_STAGE_EVENT]->(:StageEvent) } AS stageEventCount
    RETURN c.caseId AS caseId,
           c.caseName AS caseName,
           c.caseNumber AS caseNumber,
           c.caseType AS caseType,
           c.legalStage AS legalStage,
           c.subStage AS subStage,
           client.name AS clientName,
           insurers,
           injuries,
           bodyParts,
           rawSignals AS signalRows,
           documentCount,
           communicationCount,
           activityCount,
           stageEventCount
  `;
  const { rows, meta } = await runReadQueryWithMeta(cypher, { caseId: canonicalCaseId }, rowSchema);
  const row = rows[0];
  if (!row) throw new CaseNotFoundError(caseId);
  const groupedSignals = new Map<string, string[]>();
  for (const signal of row.signalRows) {
    const labels = groupedSignals.get(signal.kind) ?? [];
    if (labels.length < 6) labels.push(signal.label);
    groupedSignals.set(signal.kind, labels);
  }
  return {
    caseId: row.caseId,
    caseName: row.caseName,
    caseNumber: row.caseNumber,
    caseType: row.caseType,
    legalStage: row.legalStage,
    subStage: row.subStage,
    clientName: row.clientName,
    insurers: row.insurers.filter(Boolean),
    injuries: row.injuries.filter(Boolean),
    bodyParts: row.bodyParts.filter(Boolean),
    signalSnapshot: Array.from(groupedSignals.entries()).map(([kind, labels]) => ({ kind, labels })),
    counts: {
      documents: row.documentCount,
      communications: row.communicationCount,
      activities: row.activityCount,
      stageEvents: row.stageEventCount,
    },
    meta,
  };
}

export const getCaseGraphContextTool: ToolDefinition<typeof inputSchema, CaseGraphContext> = {
  name: 'getCaseGraphContext',
  label: 'Fetching case graph context',
  inputSchema,
  execute,
  summarize: (result) =>
    `${result.caseName} @ ${result.legalStage}${result.subStage ? ` / ${result.subStage}` : ''}, ${result.signalSnapshot.length} signal groups`,
  extractEvidence: (result) => [
    {
      sourceType: 'Case',
      sourceId: result.caseId,
      label: result.caseName,
      viaTool: 'getCaseGraphContext',
    },
  ],
  traceMeta: (result) => result.meta,
};
