import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import { neo4jNullableNumber, neo4jNullableString, neo4jNumber, neo4jString } from './_shared/neo4jMap';
import { assertStageExists, resolveCaseId } from './_shared/notFound';
import type { EvidenceItem } from '@/types/trace.types';
import type { ToolDefinition } from './types';
import {
  NoReadinessCohortError,
  cohortUncertaintyReasons,
  resolveSelectedCohort,
  type ReadinessAvailability,
  type ReadinessEstimationBasis,
} from './readiness/shared';

export interface CasePatternComparison {
  caseId: string;
  targetStage: string;
  targetSubStage: string | null;
  availability: ReadinessAvailability;
  cohortAvailable: boolean;
  historicalPeerCount: number;
  estimationBasis: ReadinessEstimationBasis;
  uncertaintyReasons: string[];
  cohortKey: string;
  cohortSelectionCriteria: string;
  weightedCoverage: number;
  matchedSignals: Array<{ signalKey: string; label: string; kind: string; weight: number; observedAt: string | null; evidence: EvidenceItem[] }>;
  missingSignals: Array<{ signalKey: string; label: string; kind: string; weight: number; medianLeadDays: number | null }>;
  contextDifferences: Array<{ signalKey: string; label: string; kind: string; weight: number; medianLeadDays: number | null }>;
  meta: QueryMeta;
}

const inputSchema = z.object({
  caseId: z.string().describe('Canonical caseId, Mongo _id, or Neo4j Case.sourceId'),
  targetStage: z.string(),
  targetSubStage: z.string().optional(),
});

const evidenceSchema = z.object({
  sourceType: z.enum(['Document', 'Communication', 'ActivityEvent']),
  sourceId: neo4jString,
  label: neo4jString,
});

const rowSchema = z.object({
  signalKey: neo4jString,
  label: neo4jString,
  kind: neo4jString,
  weight: neo4jNumber,
  medianLeadDays: neo4jNullableNumber,
  observedAt: neo4jNullableString,
  evidence: z.array(evidenceSchema),
});

const CONTEXT_SIGNAL_KINDS = new Set(['injury', 'bodyPart', 'insurer', 'contactRole']);

function sparseComparison(input: {
  caseId: string;
  targetStage: string;
  targetSubStage: string | null;
  historicalPeerCount: number;
}): CasePatternComparison {
  return {
    caseId: input.caseId,
    targetStage: input.targetStage,
    targetSubStage: input.targetSubStage,
    availability: input.historicalPeerCount > 0 ? 'sparse_stage' : 'none',
    cohortAvailable: false,
    historicalPeerCount: input.historicalPeerCount,
    estimationBasis: 'none',
    uncertaintyReasons: [
      input.historicalPeerCount > 0
        ? `No readiness cohort exists for ${input.targetStage}; only ${input.historicalPeerCount} historical case${
            input.historicalPeerCount === 1 ? '' : 's'
          } reached the stage.`
        : `No historical case reached ${input.targetStage}.`,
    ],
    cohortKey: '',
    cohortSelectionCriteria: `no readiness cohort available for ${input.targetStage}`,
    weightedCoverage: 0,
    matchedSignals: [],
    missingSignals: [],
    contextDifferences: [],
    meta: {
      cypher: 'MATCH (rc:ReadinessCohort {targetStage: $targetStage}) RETURN count(rc) AS cohorts',
      params: { targetStage: input.targetStage, targetSubStage: input.targetSubStage },
      rowCount: 0,
    },
  };
}

export async function runCompareCaseToReadinessPattern(
  input: z.infer<typeof inputSchema>
): Promise<CasePatternComparison> {
  const caseId = await resolveCaseId(input.caseId);
  await assertStageExists(input.targetStage);
  let cohort: Awaited<ReturnType<typeof resolveSelectedCohort>>['cohort'];
  try {
    ({ cohort } = await resolveSelectedCohort(
      caseId,
      input.targetStage,
      input.targetSubStage ?? null
    ));
  } catch (error: unknown) {
    if (error instanceof NoReadinessCohortError) {
      return sparseComparison({
        caseId,
        targetStage: input.targetStage,
        targetSubStage: input.targetSubStage ?? null,
        historicalPeerCount: error.historicalPeerCount,
      });
    }
    throw error;
  }
  const cypher = `
    MATCH (rc:ReadinessCohort {key: $cohortKey})-[rel:COMMON_SIGNAL]->(rs:ReadinessSignal)
    MATCH (c:Case {caseId: $caseId})
    OPTIONAL MATCH (c)-[hs:HAS_SIGNAL]->(rs)
    RETURN rs.key AS signalKey,
           rs.label AS label,
           rs.kind AS kind,
           rel.weight AS weight,
           rel.medianLeadDays AS medianLeadDays,
           toString(hs.firstObservedAt) AS observedAt,
           [(c)-[:HAS_DOCUMENT]->(d:Document)-[:EMITS_SIGNAL]->(rs) | {sourceType: 'Document', sourceId: d.sourceId, label: d.fileName}][0..2] +
           [(c)-[:HAS_COMMUNICATION]->(com:Communication)-[:EMITS_SIGNAL]->(rs) | {sourceType: 'Communication', sourceId: com.sourceId, label: coalesce(com.subject, com.fromName, com.sourceId)}][0..2] +
           [(c)-[:HAS_ACTIVITY]->(ae:ActivityEvent)-[:EMITS_SIGNAL]->(rs) | {sourceType: 'ActivityEvent', sourceId: ae.sourceId, label: coalesce(ae.summary, ae.action, ae.sourceId)}][0..2] AS evidence
    ORDER BY rel.weight DESC, rs.label ASC
  `;
  const { rows, meta } = await runReadQueryWithMeta(
    cypher,
    { cohortKey: cohort.key, caseId },
    rowSchema
  );
  const matchedSignals = rows
    .filter((row) => row.observedAt !== null)
    .map((row) => ({
      signalKey: row.signalKey,
      label: row.label,
      kind: row.kind,
      weight: row.weight,
      observedAt: row.observedAt,
      evidence: row.evidence.map((item) => ({ ...item, viaTool: 'compareCaseToReadinessPattern' })),
    }));
  const unmatchedSignals = rows
    .filter((row) => row.observedAt === null)
    .map((row) => ({
      signalKey: row.signalKey,
      label: row.label,
      kind: row.kind,
      weight: row.weight,
      medianLeadDays: row.medianLeadDays,
    }));
  const missingSignals = unmatchedSignals.filter((row) => !CONTEXT_SIGNAL_KINDS.has(row.kind));
  const contextDifferences = unmatchedSignals.filter((row) => CONTEXT_SIGNAL_KINDS.has(row.kind));
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  const matchedWeight = matchedSignals.reduce((sum, row) => sum + row.weight, 0);
  return {
    caseId,
    targetStage: input.targetStage,
    targetSubStage: input.targetSubStage ?? null,
    availability: 'cohort',
    cohortAvailable: true,
    historicalPeerCount: cohort.memberCount,
    estimationBasis: 'cohort_similar_cases',
    uncertaintyReasons: cohortUncertaintyReasons(cohort),
    cohortKey: cohort.key,
    cohortSelectionCriteria: cohort.cohortSelectionCriteria,
    weightedCoverage: totalWeight === 0 ? 0 : matchedWeight / totalWeight,
    matchedSignals,
    missingSignals,
    contextDifferences,
    meta,
  };
}

export const compareCaseToReadinessPatternTool: ToolDefinition<typeof inputSchema, CasePatternComparison> = {
  name: 'compareCaseToReadinessPattern',
  label: 'Comparing case to readiness pattern',
  inputSchema,
  execute: runCompareCaseToReadinessPattern,
  summarize: (result) =>
    result.cohortAvailable
      ? `coverage ${(result.weightedCoverage * 100).toFixed(0)}%, ${result.matchedSignals.length} matched, ${result.missingSignals.length} missing evidence, ${result.contextDifferences.length} context differences`
      : `No readiness cohort; ${result.historicalPeerCount} historical peer${result.historicalPeerCount === 1 ? '' : 's'}`,
  extractEvidence: (result) =>
    result.matchedSignals.flatMap((signal) => signal.evidence).slice(0, 10),
  traceMeta: (result) => result.meta,
};
