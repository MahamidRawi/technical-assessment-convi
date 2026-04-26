import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jNodePropsOf,
  neo4jNullableNodePropsOf,
  neo4jNumber,
  neo4jOptionalBoolean,
  neo4jOptionalDateTimeString,
  neo4jOptionalNumber,
  neo4jOptionalString,
  neo4jOptionalStringArray,
  neo4jString,
} from './_shared/neo4jMap';
import { deriveLegalFlags, type LegalFlags } from '@/policy/legalTiming';
import { CaseNotFoundError, resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';
import type { EvidenceItem } from '@/types/trace.types';

export interface ContactSummary {
  sourceId: string;
  name: string;
  hasPhone: boolean | null;
  hasEmail: boolean | null;
}

export interface ExpertSummary {
  name: string;
  specialty: string | null;
  side: 'ours' | 'court';
}

export type { LegalFlags };

export interface CaseOverview {
  caseId: string;
  caseName: string;
  caseNumber: string | null;
  caseType: string;
  legalStage: string;
  subStage: string | null;
  phase: string;
  status: string;
  completionRate: number;
  monthsSinceEvent: number | null;
  isOverdue: boolean | null;
  missingCritical: string[];
  eventDate: string | null;
  signedAt: string | null;
  mainInjury: string | null;
  client: ContactSummary | null;
  experts: ExpertSummary[];
  counts: { documents: number; communications: number; contacts: number };
  legalFlags: LegalFlags;
  meta: QueryMeta;
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
});

type Input = z.infer<typeof inputSchema>;

const casePropsSchema = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseNumber: neo4jOptionalString,
  caseType: neo4jString,
  legalStage: neo4jString,
  subStage: neo4jOptionalString,
  phase: neo4jString,
  status: neo4jString,
  completionRate: neo4jNumber,
  monthsSinceEvent: neo4jOptionalNumber,
  isOverdue: neo4jOptionalBoolean,
  missingCritical: neo4jOptionalStringArray,
  eventDate: neo4jOptionalDateTimeString,
  signedAt: neo4jOptionalDateTimeString,
  mainInjury: neo4jOptionalString,
});

const contactPropsSchema = z.object({
  dedupKey: neo4jOptionalString,
  sourceId: neo4jOptionalString,
  name: neo4jString,
  hasPhone: neo4jOptionalBoolean,
  hasEmail: neo4jOptionalBoolean,
});

const expertEntrySchema = z.object({
  name: neo4jString,
  specialty: neo4jOptionalString,
  side: z.enum(['ours', 'court']),
});

const rowSchema = z.object({
  c: neo4jNodePropsOf(casePropsSchema),
  client: neo4jNullableNodePropsOf(contactPropsSchema),
  docs: neo4jNumber,
  comms: neo4jNumber,
  contacts: neo4jNumber,
  experts: z.array(expertEntrySchema),
});

async function execute({ caseId }: Input): Promise<CaseOverview> {
  const canonicalCaseId = await resolveCaseId(caseId);
  const cypher = `
    MATCH (c:Case {caseId: $caseId})
    OPTIONAL MATCH (c)-[:HAS_CLIENT]->(candidate:Contact)
    WITH c, collect(candidate) AS clients
    WITH c, head([x IN clients WHERE x.dedupKey IS NOT NULL] + clients) AS client
    OPTIONAL MATCH (c)-[:HAS_DOCUMENT]->(d:Document)
    OPTIONAL MATCH (c)-[:HAS_COMMUNICATION]->(com:Communication)
    OPTIONAL MATCH (c)-[:HAS_CONTACT]->(con:Contact)
    WITH c, client,
         count(DISTINCT d) AS docs,
         count(DISTINCT com) AS comms,
         count(DISTINCT con) AS contacts,
         [(c)-[:OUR_EXPERT]->(o:Expert) | {name: o.name, specialty: o.specialty, side: 'ours'}] AS oursExperts,
         [(c)-[:COURT_EXPERT]->(co:Expert) | {name: co.name, specialty: co.specialty, side: 'court'}] AS courtExperts
    RETURN c, client, docs, comms, contacts, oursExperts + courtExperts AS experts
  `;
  const { rows, meta } = await runReadQueryWithMeta(cypher, { caseId: canonicalCaseId }, rowSchema);
  if (rows.length === 0) throw new CaseNotFoundError(caseId);

  const [row] = rows;
  if (!row) throw new CaseNotFoundError(caseId);

  let client: ContactSummary | null = null;
  if (row.client) {
    const id = row.client.dedupKey ?? row.client.sourceId;
    if (id) {
      client = {
        sourceId: id,
        name: row.client.name,
        hasPhone: row.client.hasPhone,
        hasEmail: row.client.hasEmail,
      };
    }
  }

  const monthsSinceEvent = row.c.monthsSinceEvent;

  return {
    caseId: row.c.caseId,
    caseName: row.c.caseName,
    caseNumber: row.c.caseNumber,
    caseType: row.c.caseType,
    legalStage: row.c.legalStage,
    subStage: row.c.subStage,
    phase: row.c.phase,
    status: row.c.status,
    completionRate: row.c.completionRate,
    monthsSinceEvent,
    isOverdue: row.c.isOverdue,
    missingCritical: row.c.missingCritical,
    eventDate: row.c.eventDate,
    signedAt: row.c.signedAt,
    mainInjury: row.c.mainInjury,
    client,
    experts: row.experts,
    counts: {
      documents: row.docs,
      communications: row.comms,
      contacts: row.contacts,
    },
    legalFlags: deriveLegalFlags(monthsSinceEvent),
    meta,
  };
}

export const getCaseOverviewTool: ToolDefinition<typeof inputSchema, CaseOverview> = {
  name: 'getCaseOverview',
  label: 'Fetching case overview',
  inputSchema,
  execute,
  summarize: (r) => {
    const stageLabel = r.subStage ? `${r.legalStage} / ${r.subStage}` : r.legalStage;
    const sol = r.legalFlags.approachingSoL ? ' | SoL warning' : '';
    return `${r.caseName} | ${stageLabel} | ${(r.completionRate * 100).toFixed(0)}% complete${sol}`;
  },
  extractEvidence: (r) => {
    const items: EvidenceItem[] = [
      {
        sourceType: 'Case',
        sourceId: r.caseId,
        label: r.caseName || r.caseId,
        viaTool: 'getCaseOverview',
      },
    ];
    if (r.client) {
      items.push({
        sourceType: 'Contact',
        sourceId: r.client.sourceId,
        label: r.client.name,
        viaTool: 'getCaseOverview',
      });
    }
    return items;
  },
  traceMeta: (r) => r.meta,
};
