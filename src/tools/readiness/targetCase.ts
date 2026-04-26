import { z } from 'zod';
import { runReadQuery } from '@/tools/_shared/runReadQuery';
import { runReadQueryWithMeta } from '@/tools/_shared/runReadQueryWithMeta';
import {
  neo4jNullableString,
  neo4jNumber,
  neo4jString,
} from '@/tools/_shared/neo4jMap';
import { CaseNotFoundError, resolveCaseId } from '@/tools/_shared/notFound';
import type { StageReachCount, TargetCaseSummary } from './shared';

const targetCaseRow = z.object({
  caseId: neo4jString,
  caseName: neo4jString,
  caseType: neo4jString,
  currentStage: neo4jString,
  currentSubStage: neo4jNullableString,
  eventDate: neo4jNullableString,
});

export async function resolveTargetCase(caseId: string): Promise<TargetCaseSummary> {
  const canonicalCaseId = await resolveCaseId(caseId);
  const rows = await runReadQuery(
    `MATCH (c:Case {caseId: $caseId})
     RETURN c.caseId AS caseId,
            c.caseName AS caseName,
            c.caseType AS caseType,
            c.legalStage AS currentStage,
            c.subStage AS currentSubStage,
            toString(c.eventDate) AS eventDate`,
    { caseId: canonicalCaseId },
    targetCaseRow
  );
  const row = rows[0];
  if (!row) throw new CaseNotFoundError(canonicalCaseId);
  return row;
}

export async function countStageReaches(
  targetStage: string,
  targetSubStage?: string | null,
  excludeCaseId?: string | null
): Promise<StageReachCount> {
  const cypher = `
    MATCH (:Case)-[:HAS_STAGE_EVENT]->(se:StageEvent)-[:FOR_STAGE]->(:Stage {name: $targetStage})
    WHERE coalesce(se.subStage, '') = coalesce($targetSubStage, '')
      AND ($excludeCaseId IS NULL OR se.caseId <> $excludeCaseId)
    RETURN count(DISTINCT se.caseId) AS historicalPeerCount
  `;
  const { rows, meta } = await runReadQueryWithMeta(
    cypher,
    {
      targetStage,
      targetSubStage: targetSubStage ?? null,
      excludeCaseId: excludeCaseId ?? null,
    },
    z.object({ historicalPeerCount: neo4jNumber })
  );
  return {
    targetStage,
    targetSubStage: targetSubStage ?? null,
    historicalPeerCount: rows[0]?.historicalPeerCount ?? 0,
    meta,
  };
}
