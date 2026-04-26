export const LANGFUSE_PROMPT_CASE_REASONER_SYSTEM = 'case-reasoner-system';

export function langfuseToolDescriptionPromptName(toolName: string): string {
  return `tool-${toolName}-description`;
}
