import { z } from 'zod';
import { runReadQuery } from './_shared/runReadQuery';
import {
  neo4jDateTimeString,
  neo4jNullableDateTimeString,
  neo4jNullableString,
  neo4jString,
  neo4jStringArray,
} from './_shared/neo4jMap';
import { CaseNotFoundError, resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';

export interface StageTimelineEntry {
  stage: string;
  at: string;
  daysFromEvent: number | null;
}

export interface StageTimeline {
  caseId: string;
  eventDate: string | null;
  currentStage: string | null;
  history: StageTimelineEntry[];
  knownStageTaxonomy: string[];
  /** @deprecated Use knownStageTaxonomy. This is a graph-wide taxonomy, not a progression path. */
  availableStages: string[];
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
});

type Input = z.infer<typeof inputSchema>;

const rowSchema = z.object({
  caseId: neo4jString,
  eventDate: neo4jNullableDateTimeString,
  currentStage: neo4jNullableString,
  history: z.array(
    z.union([
      z.object({
        stage: neo4jNullableString,
        at: z.union([neo4jDateTimeString, z.null()]),
      }),
      z.null(),
    ])
  ),
  allStages: neo4jStringArray,
});

async function execute({ caseId }: Input): Promise<StageTimeline> {
  const canonicalCaseId = await resolveCaseId(caseId);
  const cypher = `
    MATCH (c:Case {caseId: $caseId})
    OPTIONAL MATCH (c)-[r:REACHED_STAGE]->(s:Stage)
    WITH c, collect({stage: s.name, at: r.at}) AS history
    MATCH (anyStage:Stage)
    WITH c, history, collect(DISTINCT anyStage.name) AS allStages
    RETURN c.caseId AS caseId,
           c.eventDate AS eventDate,
           c.legalStage AS currentStage,
           history,
           allStages
  `;
  const rows = await runReadQuery(cypher, { caseId: canonicalCaseId }, rowSchema);
  if (rows.length === 0) {
    throw new CaseNotFoundError(caseId);
  }
  const [row] = rows;
  if (!row) throw new CaseNotFoundError(caseId);
  const eventDate = row.eventDate;
  const history: StageTimelineEntry[] = row.history
    .filter((r): r is { stage: string; at: string } => r !== null && r.stage !== null && r.at !== null)
    .map((r) => {
      const at = r.at;
      let daysFromEvent: number | null = null;
      if (eventDate && at) {
        const diffMs = new Date(at).getTime() - new Date(eventDate).getTime();
        if (!Number.isNaN(diffMs)) daysFromEvent = Math.floor(diffMs / 86_400_000);
      }
      return { stage: String(r.stage), at, daysFromEvent };
    })
    .sort((a, b) => a.at.localeCompare(b.at));

  return {
    caseId: row.caseId,
    eventDate,
    currentStage: row.currentStage,
    knownStageTaxonomy: row.allStages.filter(Boolean),
    history,
    availableStages: row.allStages.filter(Boolean),
  };
}

export const getStageTimelineTool: ToolDefinition<typeof inputSchema, StageTimeline> = {
  name: 'getStageTimeline',
  label: 'Fetching stage timeline',
  inputSchema,
  execute,
  summarize: (r) =>
    `${r.history.length} observed stage transition(s), ${r.knownStageTaxonomy.length} known stage labels`,
  extractEvidence: (r) => [
    {
      sourceType: 'Case',
      sourceId: r.caseId,
      label: `${r.history.length} stage(s) reached`,
      viaTool: 'getStageTimeline',
    },
  ],
};
