export type AgentToolMode = 'mcp' | 'atomic';

export function getAgentToolMode(
  env: Record<string, string | undefined> = process.env
): AgentToolMode {
  const value = env.AGENT_TOOL_MODE?.trim().toLowerCase();
  return value === 'atomic' ? 'atomic' : 'mcp';
}
