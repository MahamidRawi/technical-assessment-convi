import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import { assertStageExists, resolveCaseId } from './_shared/notFound';
import { MIN_SIGNAL_LIFT, MIN_SIGNAL_SUPPORT } from '@/constants/readiness';
import type { ToolDefinition } from './types';
import {
  NoGlobalReadinessCohortError,
  NoReadinessCohortError,
  cohortUncertaintyReasons,
  resolveGlobalCohort,
  resolveSelectedCohort,
  type ReadinessAvailability,
  type ReadinessEstimationBasis,
  type SelectedCohort,
} from './readiness/shared';
import {
  COMMON_SIGNAL_CYPHER,
  WEAK_SIGNAL_CYPHER,
  signalRowSchema,
  stageReachMeta,
  type CommonSignal,
} from './deriveReadinessPattern/cypher';
import { runReadQuery } from './_shared/runReadQuery';

export interface ReadinessPattern {
  caseId: string | null;
  targetStage: string;
  targetSubStage: string | null;
  availability: ReadinessAvailability;
  cohortAvailable: boolean;
  historicalPeerCount: number;
  estimationBasis: ReadinessEstimationBasis;
  uncertaintyReasons: string[];
  cohortKey: string;
  cohortSelectionCriteria: string;
  cohortSize: number;
  cohortMemberCaseIds: string[];
  selectedCohortScope: 'caseType' | 'global';
  sameTypeMemberCount: number;
  sameTypeThinContextUsed: boolean;
  timing: {
    medianDaysToStage: number | null;
    daysToStageP25: number | null;
    daysToStageP75: number | null;
  };
  observedCommonSignals: CommonSignal[];
  observedWeakSignals: CommonSignal[];
  meta: QueryMeta;
}

const inputSchema = z.object({
  caseId: z
    .string()
    .optional()
    .describe(
      'OPTIONAL. Provide a canonical caseId, Mongo _id, or sourceId to get a caseType-aware cohort. OMIT to get the global cohort for the stage (use this when the user asks "what is the readiness pattern for X" without naming a specific case).'
    ),
  targetStage: z.string(),
  targetSubStage: z.string().optional(),
});

function sparsePattern(input: {
  caseId: string | null;
  targetStage: string;
  targetSubStage: string | null;
  historicalPeerCount: number;
}): ReadinessPattern {
  const peers = input.historicalPeerCount;
  const reason =
    peers > 0
      ? `No readiness cohort exists for ${input.targetStage}; only ${peers} historical case${peers === 1 ? '' : 's'} reached the stage.`
      : `No historical case reached ${input.targetStage}.`;
  return {
    caseId: input.caseId,
    targetStage: input.targetStage,
    targetSubStage: input.targetSubStage,
    availability: peers > 0 ? 'sparse_stage' : 'none',
    cohortAvailable: false,
    historicalPeerCount: peers,
    estimationBasis: 'none',
    uncertaintyReasons: [reason],
    cohortKey: '',
    cohortSelectionCriteria: `no readiness cohort available for ${input.targetStage}`,
    cohortSize: 0,
    cohortMemberCaseIds: [],
    selectedCohortScope: 'global',
    sameTypeMemberCount: 0,
    sameTypeThinContextUsed: false,
    timing: { medianDaysToStage: null, daysToStageP25: null, daysToStageP75: null },
    observedCommonSignals: [],
    observedWeakSignals: [],
    meta: stageReachMeta(input.targetStage, input.targetSubStage),
  };
}

async function patternFromCohort(
  caseId: string | null,
  cohort: SelectedCohort,
  targetStage: string,
  targetSubStage: string | null
): Promise<ReadinessPattern> {
  const { rows, meta } = await runReadQueryWithMeta(
    COMMON_SIGNAL_CYPHER,
    { cohortKey: cohort.key },
    signalRowSchema
  );
  const weakRows = await runReadQuery(
    WEAK_SIGNAL_CYPHER,
    { cohortKey: cohort.key },
    signalRowSchema
  );
  const reasons = cohortUncertaintyReasons(cohort);
  if (rows.length === 0 && weakRows.length > 0) {
    reasons.push(
      `No strong common signals (support>=${MIN_SIGNAL_SUPPORT}, lift>=${MIN_SIGNAL_LIFT}); ${weakRows.length} weak signal${
        weakRows.length === 1 ? '' : 's'
      } surfaced as supplementary evidence.`
    );
  }
  return {
    caseId,
    targetStage,
    targetSubStage,
    availability: 'cohort',
    cohortAvailable: true,
    historicalPeerCount: cohort.memberCount,
    estimationBasis: 'cohort_similar_cases',
    uncertaintyReasons: reasons,
    cohortKey: cohort.key,
    cohortSelectionCriteria: cohort.cohortSelectionCriteria,
    cohortSize: cohort.memberCount,
    cohortMemberCaseIds: cohort.cohortMemberCaseIds,
    selectedCohortScope: cohort.selectedCohortScope,
    sameTypeMemberCount: cohort.sameTypeMemberCount,
    sameTypeThinContextUsed: cohort.sameTypeThinContextUsed,
    timing: {
      medianDaysToStage: cohort.medianDaysToStage,
      daysToStageP25: cohort.daysToStageP25,
      daysToStageP75: cohort.daysToStageP75,
    },
    observedCommonSignals: rows,
    observedWeakSignals: weakRows,
    meta,
  };
}

export async function runDeriveReadinessPattern(
  input: z.infer<typeof inputSchema>
): Promise<ReadinessPattern> {
  await assertStageExists(input.targetStage);
  const seedCaseId = input.caseId?.trim() ? input.caseId.trim() : null;
  const targetSubStage = input.targetSubStage ?? null;
  try {
    if (seedCaseId) {
      const resolvedCaseId = await resolveCaseId(seedCaseId);
      const { cohort } = await resolveSelectedCohort(
        resolvedCaseId,
        input.targetStage,
        targetSubStage
      );
      return await patternFromCohort(resolvedCaseId, cohort, input.targetStage, targetSubStage);
    }
    const cohort = await resolveGlobalCohort(input.targetStage, targetSubStage);
    return await patternFromCohort(null, cohort, input.targetStage, targetSubStage);
  } catch (error: unknown) {
    if (error instanceof NoReadinessCohortError) {
      return sparsePattern({
        caseId: error.targetCase.caseId,
        targetStage: input.targetStage,
        targetSubStage,
        historicalPeerCount: error.historicalPeerCount,
      });
    }
    if (error instanceof NoGlobalReadinessCohortError) {
      return sparsePattern({
        caseId: null,
        targetStage: input.targetStage,
        targetSubStage,
        historicalPeerCount: error.historicalPeerCount,
      });
    }
    throw error;
  }
}

function summarize(result: ReadinessPattern): string {
  if (result.cohortAvailable) {
    const weak = result.observedWeakSignals.length;
    const weakSuffix = weak > 0 ? `, ${weak} weak signal${weak === 1 ? '' : 's'}` : '';
    return `${result.cohortSize} historical cases, ${result.observedCommonSignals.length} common signals${weakSuffix}`;
  }
  const peers = result.historicalPeerCount;
  return `No readiness cohort; ${peers} historical peer${peers === 1 ? '' : 's'}`;
}

export const deriveReadinessPatternTool: ToolDefinition<typeof inputSchema, ReadinessPattern> = {
  name: 'deriveReadinessPattern',
  label: 'Deriving readiness pattern',
  inputSchema,
  execute: runDeriveReadinessPattern,
  summarize,
  extractEvidence: (result) =>
    result.cohortMemberCaseIds.map((caseId) => ({
      sourceType: 'Case' as const,
      sourceId: caseId,
      label: `cohort member ${caseId}`,
      viaTool: 'deriveReadinessPattern',
    })),
  traceMeta: (result) => result.meta,
};
