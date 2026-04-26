import { MIN_COHORT_SIZE } from '@/constants/readiness';
import type { TargetCaseSummary } from './shared';

function reachDetail(historicalPeerCount: number): string {
  if (historicalPeerCount === 0) return 'no case in the dataset has reached this stage';
  const plural = historicalPeerCount === 1 ? '' : 's';
  return `only ${historicalPeerCount} case${plural} reached it (below MIN_COHORT_SIZE=${MIN_COHORT_SIZE})`;
}

function stageLabel(targetStage: string, targetSubStage: string | null): string {
  return targetSubStage ? `"${targetStage}" / "${targetSubStage}"` : `"${targetStage}"`;
}

export class NoReadinessCohortError extends Error {
  constructor(
    public targetCase: TargetCaseSummary,
    public targetStage: string,
    public targetSubStage: string | null,
    public historicalPeerCount: number
  ) {
    super(
      `No readiness cohort available for stage ${stageLabel(targetStage, targetSubStage)} — ${reachDetail(
        historicalPeerCount
      )}. This is a portfolio-wide data gap, not specific to caseType="${targetCase.caseType}".`
    );
    this.name = 'NoReadinessCohortError';
  }
}

export class NoGlobalReadinessCohortError extends Error {
  constructor(
    public targetStage: string,
    public targetSubStage: string | null,
    public historicalPeerCount: number
  ) {
    super(
      `No global readiness cohort for stage ${stageLabel(targetStage, targetSubStage)} — ${reachDetail(
        historicalPeerCount
      )}.`
    );
    this.name = 'NoGlobalReadinessCohortError';
  }
}
