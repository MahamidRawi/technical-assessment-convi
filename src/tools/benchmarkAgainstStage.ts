import { z } from 'zod';
import { runReadQuery } from './_shared/runReadQuery';
import { runReadQueryWithMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jNullableNumber,
  neo4jNullableStringArray,
  neo4jNumber,
  neo4jString,
  neo4jStringArray,
} from './_shared/neo4jMap';
import { CaseNotFoundError, StageNotFoundError, resolveCaseId } from './_shared/notFound';
import type { ToolDefinition } from './types';
import type { StageBenchmark, StageBenchmarkPosition } from './benchmarkAgainstStage/types';
import { shapePeerStats } from './benchmarkAgainstStage/peerStats';

export type { StageBenchmark, StageBenchmarkPosition };

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
  targetStage: z
    .string()
    .describe('Exact Stage name (resolve via getStageTimeline.availableStages if the user typed Hebrew)'),
});

type Input = z.infer<typeof inputSchema>;

const rowSchema = z.object({
  caseId: neo4jString,
  completionRate: neo4jNumber,
  monthsSinceEvent: neo4jNullableNumber,
  missingCritical: neo4jNullableStringArray,
  thisCategories: neo4jStringArray,
  peerSamples: z.array(
    z.object({
      caseId: neo4jString,
      completionRate: neo4jNullableNumber,
      monthsToStage: neo4jNullableNumber,
      categories: neo4jStringArray,
    })
  ),
});

const countRowSchema = z.object({
  count: neo4jNumber,
});

const CYPHER = `
    MATCH (c:Case {caseId: $caseId})
    OPTIONAL MATCH (c)-[:HAS_DOCUMENT]->(:Document)-[:OF_CATEGORY]->(dc:DocumentCategory)
    WITH c, collect(DISTINCT dc.name) AS thisCategories

    CALL {
      WITH c
      MATCH (peer:Case)
      WHERE peer.caseId <> c.caseId
        AND (
          peer.legalStage = $targetStage
          OR EXISTS { MATCH (peer)-[:REACHED_STAGE]->(:Stage {name: $targetStage}) }
        )
      OPTIONAL MATCH (peer)-[r:REACHED_STAGE]->(:Stage {name: $targetStage})
      WITH peer, r,
           CASE
             WHEN r IS NOT NULL AND peer.eventDate IS NOT NULL
               THEN duration.inDays(datetime(peer.eventDate), r.at).days / 30.0
             WHEN peer.legalStage = $targetStage
                  AND peer.legalStageEnteredAt IS NOT NULL
                  AND peer.eventDate IS NOT NULL
               THEN duration.inDays(datetime(peer.eventDate), datetime(peer.legalStageEnteredAt)).days / 30.0
             ELSE null
           END AS monthsToStage
      OPTIONAL MATCH (peer)-[:HAS_DOCUMENT]->(:Document)-[:OF_CATEGORY]->(peerDc:DocumentCategory)
      WITH peer, monthsToStage, collect(DISTINCT peerDc.name) AS peerCategories
      RETURN collect({
        caseId: peer.caseId,
        completionRate: peer.completionRate,
        monthsToStage: monthsToStage,
        categories: peerCategories
      }) AS peerSamples
    }

    RETURN c.caseId AS caseId,
           c.completionRate AS completionRate,
           c.monthsSinceEvent AS monthsSinceEvent,
           c.missingCritical AS missingCritical,
           thisCategories,
           peerSamples
  `;

async function assertStageExists(targetStage: string): Promise<void> {
  const rows = await runReadQuery(
    'MATCH (s:Stage {name: $targetStage}) RETURN count(s) AS count',
    { targetStage },
    countRowSchema
  );
  if ((rows[0]?.count ?? 0) === 0) throw new StageNotFoundError(targetStage);
}

async function execute({ caseId, targetStage }: Input): Promise<StageBenchmark> {
  const canonicalCaseId = await resolveCaseId(caseId);
  await assertStageExists(targetStage);
  const { rows, meta } = await runReadQueryWithMeta(
    CYPHER,
    { caseId: canonicalCaseId, targetStage },
    rowSchema
  );
  const row = rows[0];
  if (!row) throw new CaseNotFoundError(canonicalCaseId);

  const thisCoveredCategories = row.thisCategories.filter(Boolean);
  const thisCase = {
    completionRate: row.completionRate,
    monthsSinceEvent: row.monthsSinceEvent,
    documentCoverage: thisCoveredCategories.length,
    coveredCategories: thisCoveredCategories,
    missingCritical: row.missingCritical,
  };

  const samples = row.peerSamples;

  if (samples.length === 0) {
    return {
      targetStage,
      peerCount: 0,
      thisCase,
      peers: {
        completionRate: null,
        monthsFromEventToStage: null,
        documentCoverage: null,
        mostCommonCategories: [],
        sampleCaseIds: [],
      },
      position: { completionRate: 'no_data', timeline: 'no_data', coverage: 'no_data' },
      meta,
    };
  }

  const { peers, position } = shapePeerStats(samples, thisCase);
  return { targetStage, peerCount: samples.length, thisCase, peers, position, meta };
}

export const benchmarkAgainstStageTool: ToolDefinition<typeof inputSchema, StageBenchmark> = {
  name: 'benchmarkAgainstStage',
  label: 'Benchmarking against stage',
  inputSchema,
  execute,
  summarize: (r) => {
    if (r.peerCount === 0) return `No peers reached ${r.targetStage}`;
    return `${r.peerCount} peers @ ${r.targetStage} — coverage=${r.position.coverage}, completion=${r.position.completionRate}, timeline=${r.position.timeline}`;
  },
  extractEvidence: (r) =>
    r.peers.sampleCaseIds.slice(0, 5).map((peerId) => ({
      sourceType: 'Case' as const,
      sourceId: peerId,
      label: `peer @ ${r.targetStage}`,
      viaTool: 'benchmarkAgainstStage',
    })),
  traceMeta: (r) => r.meta,
};
