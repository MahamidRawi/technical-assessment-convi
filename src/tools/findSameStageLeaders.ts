import { z } from 'zod';
import { runReadQuery } from './_shared/runReadQuery';
import {
  neo4jNodePropsOf,
  neo4jNumber,
  neo4jOptionalBoolean,
  neo4jOptionalNumber,
  neo4jString,
} from './_shared/neo4jMap';
import { resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface StageLeaderRow {
  caseId: string;
  caseName: string;
  caseType: string;
  completionRate: number;
  monthsSinceEvent: number | null;
  isOverdue: boolean | null;
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
  limit: z.number().int().min(1).max(10).default(5),
});

type Input = z.infer<typeof inputSchema>;

const peerPropsSchema = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseType: neo4jString,
  completionRate: neo4jNumber,
  monthsSinceEvent: neo4jOptionalNumber,
  isOverdue: neo4jOptionalBoolean,
});

const rowSchema = z.object({
  peer: neo4jNodePropsOf(peerPropsSchema),
});

async function execute({ caseId, limit }: Input): Promise<StageLeaderRow[]> {
  const canonicalCaseId = await resolveCaseId(caseId);
  const cypher = `
    MATCH (c:Case {caseId: $caseId})-[:IN_STAGE]->(s:Stage)
    MATCH (s)<-[:IN_STAGE]-(peer:Case)
    WHERE peer.caseId <> c.caseId
    RETURN peer
    ORDER BY peer.completionRate DESC, coalesce(peer.monthsSinceEvent, 9999) ASC
    LIMIT toInteger($limit)
  `;
  const rows = await runReadQuery(cypher, { caseId: canonicalCaseId, limit }, rowSchema);

  return rows.map((row) => ({
    caseId: row.peer.caseId,
    caseName: row.peer.caseName,
    caseType: row.peer.caseType,
    completionRate: row.peer.completionRate,
    monthsSinceEvent: row.peer.monthsSinceEvent,
    isOverdue: row.peer.isOverdue,
  }));
}

export const findSameStageLeadersTool: ToolDefinition<typeof inputSchema, StageLeaderRow[]> = {
  name: 'findSameStageLeaders',
  label: 'Benchmarking against same stage',
  inputSchema,
  execute,
  summarize: (r) => `${r.length} same-stage peers`,
  extractEvidence: (r) =>
    r.map((c) => ({
      sourceType: 'Case' as const,
      sourceId: c.caseId,
      label: `${c.caseName} (${(c.completionRate * 100).toFixed(0)}%)`,
      viaTool: 'findSameStageLeaders',
    })),
};
