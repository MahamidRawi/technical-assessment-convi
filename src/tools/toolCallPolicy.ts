import type { ToolPlan } from '@/agents/intentPlanner';
import { isKnownCaseType } from '@/agents/intentPlanner';

function hasOwnArg(input: unknown, arg: string): boolean {
  if (!input || typeof input !== 'object') return false;
  const value = (input as Record<string, unknown>)[arg];
  return value !== undefined && value !== null && value !== '';
}

export function validateToolCallAgainstPlan(
  toolName: string,
  input: unknown,
  plan?: ToolPlan
): void {
  if (toolName === 'findSimilarCases' && input && typeof input === 'object') {
    const caseId = (input as Record<string, unknown>).caseId;
    if (typeof caseId === 'string' && isKnownCaseType(caseId)) {
      throw new Error(
        `findSimilarCases requires a resolved caseId; "${caseId}" is a caseType. Use rankSimilarCasePairs for global similarity.`
      );
    }
  }

  if (toolName === 'getCaseCommunications' && hasOwnArg(input, 'direction')) {
    if (!plan?.allowCommunicationDirection) {
      throw new Error(
        'getCaseCommunications.direction is allowed only when the user explicitly requested incoming/outgoing communications.'
      );
    }
  }

  for (const forbidden of plan?.forbiddenArgs ?? []) {
    if (forbidden.tool === toolName && hasOwnArg(input, forbidden.arg)) {
      throw new Error(
        `${toolName}.${forbidden.arg} is forbidden for this turn by the planner route.`
      );
    }
  }
}
