import { z } from 'zod';
import { runReadQuery } from './_shared/runReadQuery';
import {
  neo4jNodePropsOf,
  neo4jOptionalDateTimeString,
  neo4jOptionalString,
  neo4jString,
  neo4jStringArray,
} from './_shared/neo4jMap';
import { resolveCaseId } from './_shared/notFound';
import { textPreview } from '@/utils/hebrew';
import type { ToolDefinition } from './types';

export interface CommunicationRow {
  sourceId: string;
  sentAt: string | null;
  direction: string;
  fromName: string;
  subject: string;
  textPreview: string;
  fromContacts: string[];
  toContacts: string[];
  ccContacts: string[];
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
  limit: z.number().int().min(1).max(30).default(10),
  direction: z
    .enum(['incoming', 'outgoing'])
    .optional()
    .describe(
      "OMIT entirely for unfiltered communications. Pass 'incoming' or 'outgoing' ONLY when the user explicitly asks for one direction (e.g. 'incoming emails', 'outgoing whatsapp messages')."
    ),
  senderContactType: z
    .string()
    .optional()
    .describe(
      "Filters to communications whose FROM_CONTACT participant has the given contactType (e.g. 'insurance_company', 'lawyer', 'doctor', 'client'). Use for prompts like 'did the insurer initiate any thread', 'messages from the doctor', 'show the insurer's outreach'. CRITICAL: when senderContactType is set, OMIT the direction filter — senderContactType already specifies who sent the message. Combining the two over-filters and frequently returns 0 false-negatives."
    ),
});

type Input = z.infer<typeof inputSchema>;

const communicationPropsSchema = z.object({
  sourceId: neo4jString,
  sentAt: neo4jOptionalDateTimeString,
  direction: neo4jOptionalString,
  fromName: neo4jOptionalString,
  subject: neo4jOptionalString,
  textPreview: neo4jOptionalString,
});

const rowSchema = z.object({
  com: neo4jNodePropsOf(communicationPropsSchema),
  fromContacts: neo4jStringArray,
  toContacts: neo4jStringArray,
  ccContacts: neo4jStringArray,
});

async function execute({
  caseId,
  limit,
  direction,
  senderContactType,
}: Input): Promise<CommunicationRow[]> {
  const canonicalCaseId = await resolveCaseId(caseId);
  // When senderContactType is set, direction is redundant at best ("incoming
  // from doctor" == "from doctor") and contradictory at worst ("outgoing from
  // doctor"). Drop direction to keep the result correct even if the agent
  // over-filters.
  const effectiveDirection = senderContactType?.trim() ? null : (direction ?? null);
  const cypher = `
    MATCH (c:Case {caseId: $caseId})-[:HAS_COMMUNICATION]->(com:Communication)
    WHERE $direction IS NULL OR com.direction = $direction
    WITH com
    WHERE $senderContactType IS NULL OR EXISTS {
      MATCH (com)-[:FROM_CONTACT]->(sender:Contact)
      WHERE sender.contactType = $senderContactType
    }
    CALL {
      WITH com
      OPTIONAL MATCH (com)-[:FROM_CONTACT]->(from:Contact)
      RETURN [name IN collect(DISTINCT from.name) WHERE name IS NOT NULL] AS fromContacts
    }
    CALL {
      WITH com
      OPTIONAL MATCH (com)-[:TO_CONTACT]->(to:Contact)
      RETURN [name IN collect(DISTINCT to.name) WHERE name IS NOT NULL] AS toContacts
    }
    CALL {
      WITH com
      OPTIONAL MATCH (com)-[:CC_CONTACT]->(cc:Contact)
      RETURN [name IN collect(DISTINCT cc.name) WHERE name IS NOT NULL] AS ccContacts
    }
    RETURN com, fromContacts, toContacts, ccContacts
    ORDER BY com.sentAt DESC
    LIMIT toInteger($limit)
  `;
  const rows = await runReadQuery(
    cypher,
    {
      caseId: canonicalCaseId,
      direction: effectiveDirection,
      senderContactType: senderContactType?.trim() ? senderContactType.trim() : null,
      limit,
    },
    rowSchema
  );

  return rows.map((row) => ({
    sourceId: row.com.sourceId,
    sentAt: row.com.sentAt,
    direction: row.com.direction ?? '',
    fromName: row.fromContacts[0] ?? row.com.fromName ?? '',
    subject: row.com.subject ?? '',
    textPreview: textPreview(row.com.textPreview ?? '', 300),
    fromContacts: row.fromContacts,
    toContacts: row.toContacts,
    ccContacts: row.ccContacts,
  }));
}

export const getCaseCommunicationsTool: ToolDefinition<typeof inputSchema, CommunicationRow[]> = {
  name: 'getCaseCommunications',
  label: 'Fetching communications',
  inputSchema,
  execute,
  summarize: (r) =>
    `${r.length} communications${r.some((row) => row.toContacts.length > 0 || row.ccContacts.length > 0) ? ', participants linked' : ''}`,
  extractEvidence: (r) =>
    r.map((c) => ({
      sourceType: 'Communication' as const,
      sourceId: c.sourceId,
      label: c.subject || c.fromName || c.sourceId,
      viaTool: 'getCaseCommunications',
    })),
};
