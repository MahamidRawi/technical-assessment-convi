import type { z } from 'zod';
import type { ToolDefinition } from './types';
import { getCaseOverviewTool } from './getCaseOverview';
import { getCaseEvidenceTool } from './getCaseEvidence';
import { getCaseDocumentsTool } from './getCaseDocuments';
import { getCaseCommunicationsTool } from './getCaseCommunications';
import { findSimilarCasesTool } from './findSimilarCases';
import { findSameStageLeadersTool } from './findSameStageLeaders';
import { getReadinessSignalsTool } from './getReadinessSignals';
import { getCaseInjuryProfileTool } from './getCaseInjuryProfile';
import { getStageTimelineTool } from './getStageTimeline';
import { benchmarkAgainstStageTool } from './benchmarkAgainstStage';
import { searchCasesTool } from './searchCases';
import { portfolioAggregatesTool } from './portfolioAggregates';
import { rankCasesByStageTransitionTimeTool } from './rankCasesByStageTransitionTime';
import { findCaseTool } from './findCase';
import { getCaseGraphContextTool } from './getCaseGraphContext';
import { deriveReadinessPatternTool } from './deriveReadinessPattern';
import { compareCaseToReadinessPatternTool } from './compareCaseToReadinessPattern';
import { estimateTimeToStageTool } from './estimateTimeToStage';
import { listPortfolioContactsTool } from './listPortfolioContacts';
import { listPortfolioExpertsTool } from './listPortfolioExperts';
import { searchDocumentEvidenceTool } from './searchDocumentEvidence';
import { getCaseDocumentFactsTool } from './getCaseDocumentFacts';
import { findComparableCasesByFactsTool } from './findComparableCasesByFacts';
import { getCaseValueContextTool } from './getCaseValueContext';
import { searchCasesByMedicalEvidenceTool } from './searchCasesByMedicalEvidence';

export type AddTool = <TSchema extends z.ZodTypeAny, TResult>(
  def: ToolDefinition<TSchema, TResult>
) => void;

export const TOOL_ENTRIES = [
  { name: findCaseTool.name },
  ...(process.env.AGENT_ADVANCED_TOOLS === 'true'
    ? [{ name: getCaseGraphContextTool.name }]
    : []),
  { name: getCaseOverviewTool.name },
  { name: getCaseEvidenceTool.name },
  { name: getCaseDocumentsTool.name },
  { name: searchDocumentEvidenceTool.name },
  { name: getCaseDocumentFactsTool.name },
  { name: getCaseCommunicationsTool.name },
  { name: findSimilarCasesTool.name },
  { name: findSameStageLeadersTool.name },
  { name: getReadinessSignalsTool.name },
  { name: getCaseInjuryProfileTool.name },
  { name: getStageTimelineTool.name },
  { name: benchmarkAgainstStageTool.name },
  { name: searchCasesTool.name },
  { name: searchCasesByMedicalEvidenceTool.name },
  { name: portfolioAggregatesTool.name },
  { name: listPortfolioContactsTool.name },
  { name: listPortfolioExpertsTool.name },
  { name: findComparableCasesByFactsTool.name },
  { name: getCaseValueContextTool.name },
  { name: rankCasesByStageTransitionTimeTool.name },
  { name: deriveReadinessPatternTool.name },
  { name: compareCaseToReadinessPatternTool.name },
  { name: estimateTimeToStageTool.name },
] as const;

export function forEachTool(addTool: AddTool): void {
  addTool(findCaseTool);
  if (process.env.AGENT_ADVANCED_TOOLS === 'true') addTool(getCaseGraphContextTool);
  addTool(getCaseOverviewTool);
  addTool(getCaseEvidenceTool);
  addTool(getCaseDocumentsTool);
  addTool(searchDocumentEvidenceTool);
  addTool(getCaseDocumentFactsTool);
  addTool(getCaseCommunicationsTool);
  addTool(findSimilarCasesTool);
  addTool(findSameStageLeadersTool);
  addTool(getReadinessSignalsTool);
  addTool(getCaseInjuryProfileTool);
  addTool(getStageTimelineTool);
  addTool(benchmarkAgainstStageTool);
  addTool(searchCasesTool);
  addTool(searchCasesByMedicalEvidenceTool);
  addTool(portfolioAggregatesTool);
  addTool(listPortfolioContactsTool);
  addTool(listPortfolioExpertsTool);
  addTool(findComparableCasesByFactsTool);
  addTool(getCaseValueContextTool);
  addTool(rankCasesByStageTransitionTimeTool);
  addTool(deriveReadinessPatternTool);
  addTool(compareCaseToReadinessPatternTool);
  addTool(estimateTimeToStageTool);
}
