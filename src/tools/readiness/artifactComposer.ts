import type { ReadinessDecisionArtifact } from '@/types/trace.types';
import type { ReadinessPattern } from '../deriveReadinessPattern';
import type { CasePatternComparison } from '../compareCaseToReadinessPattern';
import type { StageTimeEstimate } from '../estimateTimeToStage';
import { resolveTargetCase } from './shared';

interface ReadinessParts {
  pattern?: ReadinessPattern;
  comparison?: CasePatternComparison;
  estimate?: StageTimeEstimate;
}

function keyFor(caseId: string, targetStage: string, targetSubStage: string | null): string {
  return [caseId, targetStage, targetSubStage ?? ''].join('|');
}

function resultKey(result: {
  caseId: string;
  targetStage: string;
  targetSubStage: string | null;
}): string {
  return keyFor(result.caseId, result.targetStage, result.targetSubStage);
}

export class ReadinessArtifactComposer {
  private readonly partsByKey = new Map<string, ReadinessParts>();
  private readonly emittedKeys = new Set<string>();

  async observe(toolName: string, result: unknown): Promise<ReadinessDecisionArtifact | null> {
    if (
      toolName !== 'deriveReadinessPattern' &&
      toolName !== 'compareCaseToReadinessPattern' &&
      toolName !== 'estimateTimeToStage'
    ) {
      return null;
    }

    const keyed = result as {
      caseId: string;
      targetStage: string;
      targetSubStage: string | null;
    };
    if (!keyed.caseId || !keyed.targetStage) return null;

    const key = resultKey(keyed);
    const parts = this.partsByKey.get(key) ?? {};
    if (toolName === 'deriveReadinessPattern') parts.pattern = result as ReadinessPattern;
    if (toolName === 'compareCaseToReadinessPattern') {
      parts.comparison = result as CasePatternComparison;
    }
    if (toolName === 'estimateTimeToStage') parts.estimate = result as StageTimeEstimate;
    this.partsByKey.set(key, parts);

    if (this.emittedKeys.has(key) || !parts.pattern || !parts.comparison || !parts.estimate) {
      return null;
    }
    if (!parts.pattern.caseId) return null;

    const targetCase = await resolveTargetCase(parts.pattern.caseId);
    this.emittedKeys.add(key);
    return {
      question: 'Readiness analysis',
      targetCase,
      targetStage: parts.pattern.targetStage,
      targetSubStage: parts.pattern.targetSubStage,
      toolsUsed: [
        'deriveReadinessPattern',
        'compareCaseToReadinessPattern',
        'estimateTimeToStage',
      ],
      availability: parts.estimate.availability,
      cohortAvailable: parts.estimate.cohortAvailable,
      historicalPeerCount: parts.estimate.historicalPeerCount,
      estimationBasis: parts.estimate.estimationBasis,
      cohortSelectionCriteria: parts.pattern.cohortSelectionCriteria,
      cohortSize: parts.pattern.cohortSize,
      cohortMemberCaseIds: parts.pattern.cohortMemberCaseIds,
      observedCommonSignals: parts.pattern.observedCommonSignals,
      matchedSignals: parts.comparison.matchedSignals,
      missingSignals: parts.comparison.missingSignals,
      contextDifferences: parts.comparison.contextDifferences,
      timelineEstimate: {
        timingStatus: parts.estimate.timingStatus,
        remainingDaysMedian: parts.estimate.remainingDaysMedian,
        remainingDaysP25: parts.estimate.remainingDaysP25,
        remainingDaysP75: parts.estimate.remainingDaysP75,
        behindByDaysMedian: parts.estimate.behindByDaysMedian,
        behindByDaysP25: parts.estimate.behindByDaysP25,
        behindByDaysP75: parts.estimate.behindByDaysP75,
        comparableCaseIds: parts.estimate.comparableCaseIds,
        timingSources: parts.estimate.timingSources,
      },
      confidence: parts.estimate.confidence,
      uncertaintyReasons: Array.from(
        new Set([
          ...parts.pattern.uncertaintyReasons,
          ...parts.comparison.uncertaintyReasons,
          ...parts.estimate.uncertaintyReasons,
        ])
      ),
      optionalPolicyBaselineComparison: null,
    };
  }
}
