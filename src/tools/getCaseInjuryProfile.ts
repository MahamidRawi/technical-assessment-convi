import { z } from 'zod';
import { runReadQuery } from './_shared/runReadQuery';
import { neo4jNullableString, neo4jString, neo4jStringArray } from './_shared/neo4jMap';
import { CaseNotFoundError, resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';
import type { EvidenceItem } from '@/types/trace.types';

export interface InjuryProfile {
  caseId: string;
  mainInjury: string | null;
  injuries: Array<{ name: string; status: 'initial' | 'current' }>;
  bodyParts: string[];
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
});

type Input = z.infer<typeof inputSchema>;

const rowSchema = z.object({
  caseId: neo4jString,
  mainInjury: neo4jNullableString,
  injuries: z.array(
    z.union([
      z.object({
        name: neo4jNullableString,
        status: neo4jNullableString,
      }),
      z.null(),
    ])
  ),
  bodyParts: neo4jStringArray,
});

function toInjuryStatus(value: unknown): InjuryProfile['injuries'][number]['status'] {
  return value === 'current' ? 'current' : 'initial';
}

async function execute({ caseId }: Input): Promise<InjuryProfile> {
  const canonicalCaseId = await resolveCaseId(caseId);
  const cypher = `
    MATCH (c:Case {caseId: $caseId})
    OPTIONAL MATCH (c)-[hi:HAS_INJURY]->(i:Injury)
    WITH c, collect(DISTINCT {name: i.name, status: hi.status}) AS injuries
    OPTIONAL MATCH (c)-[:AFFECTS_BODY_PART]->(b:BodyPart)
    RETURN c.caseId AS caseId,
           c.mainInjury AS mainInjury,
           injuries,
           collect(DISTINCT b.name) AS bodyParts
  `;
  const rows = await runReadQuery(cypher, { caseId: canonicalCaseId }, rowSchema);
  if (rows.length === 0) {
    throw new CaseNotFoundError(caseId);
  }
  const [row] = rows;
  if (!row) throw new CaseNotFoundError(caseId);
  const injuries = row.injuries
    .filter((r): r is { name: string; status: string | null } => r !== null && r.name !== null)
    .map((r) => {
      const status = toInjuryStatus(r.status);
      return { name: String(r.name), status };
    });
  const bodyParts = row.bodyParts.filter(Boolean);
  return {
    caseId: row.caseId,
    mainInjury: row.mainInjury,
    injuries,
    bodyParts,
  };
}

export const getCaseInjuryProfileTool: ToolDefinition<typeof inputSchema, InjuryProfile> = {
  name: 'getCaseInjuryProfile',
  label: 'Fetching injury profile',
  inputSchema,
  execute,
  summarize: (r) =>
    `${r.injuries.length} injuries, ${r.bodyParts.length} body parts${r.mainInjury ? `, main: ${r.mainInjury}` : ''}`,
  extractEvidence: (r) => {
    const items: EvidenceItem[] = [
      {
        sourceType: 'Case',
        sourceId: r.caseId,
        label: r.mainInjury ?? r.caseId,
        viaTool: 'getCaseInjuryProfile',
      },
    ];
    for (const inj of r.injuries) {
      items.push({
        sourceType: 'Case',
        sourceId: `${r.caseId}:injury:${inj.name}`,
        label: `(${inj.status}) ${inj.name}`,
        viaTool: 'getCaseInjuryProfile',
      });
    }
    return items;
  },
};
