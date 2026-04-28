import { createMCPClient, type ListToolsResult, type MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';
import type { Configuration } from '@ai-sdk/mcp';
import type { StepTrace } from '@/types/trace.types';
import { toToolErrorResult } from './toolErrors';
import type { ToolRunnerCallbacks } from './toolRunner';
import {
  diagnoseEmptyCaseQuery,
  formatVerdictForAgent,
  preflightCypherAsync,
  safetyEnabled,
} from './mcpNeo4jSafety';
import { connectNeo4j, createSession } from '@/db/neo4j';

export interface McpToolRuntime {
  tools: ToolSet;
  close(): Promise<void>;
  toolNames: string[];
  serverInfo: Configuration;
}

interface Neo4jMcpConfig {
  allowedTools: string[];
  allowWrite: boolean;
  transport:
    | { type: 'http'; url: string; headers?: Record<string, string> }
    | { type: 'stdio'; command: string; args: string[]; env: Record<string, string> };
}

const DEFAULT_ALLOWED_TOOLS = ['get-schema', 'read-cypher'];
type Env = Record<string, string | undefined>;

function cleanEnv(env: Env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  const values = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values && values.length > 0 ? values : fallback;
}

function parseArgs(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new Error('MCP_NEO4J_ARGS JSON must be an array of strings.');
    }
    return parsed;
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

function parseHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value?.trim()) return undefined;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP_NEO4J_HEADERS_JSON must be a JSON object.');
  }
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

export function resolveNeo4jMcpConfig(env: Env = process.env): Neo4jMcpConfig {
  const allowWrite = env.MCP_NEO4J_ALLOW_WRITE === 'true';
  const allowedTools = parseCsv(env.MCP_NEO4J_ALLOWED_TOOLS, DEFAULT_ALLOWED_TOOLS);
  if (!allowWrite && allowedTools.some((name) => /(^|[-_])(write|create|update|delete|merge)/i.test(name))) {
    throw new Error(
      'Refusing to expose write-capable MCP tools. Set MCP_NEO4J_ALLOW_WRITE=true only for non-production experiments.'
    );
  }

  const httpUrl = env.MCP_NEO4J_URL?.trim();
  if (httpUrl) {
    return {
      allowedTools,
      allowWrite,
      transport: {
        type: 'http',
        url: httpUrl,
        headers: parseHeaders(env.MCP_NEO4J_HEADERS_JSON),
      },
    };
  }

  const mcpEnv = cleanEnv(env);
  if (!mcpEnv.NEO4J_USERNAME && mcpEnv.NEO4J_USER) {
    mcpEnv.NEO4J_USERNAME = mcpEnv.NEO4J_USER;
  }
  mcpEnv.NEO4J_READ_ONLY = allowWrite ? 'false' : 'true';

  return {
    allowedTools,
    allowWrite,
    transport: {
      type: 'stdio',
      command: env.MCP_NEO4J_COMMAND?.trim() || 'neo4j-mcp',
      args: parseArgs(env.MCP_NEO4J_ARGS),
      env: mcpEnv,
    },
  };
}

function filterToolDefinitions(
  definitions: ListToolsResult,
  allowedTools: readonly string[]
): ListToolsResult {
  const allowed = new Set(allowedTools);
  return {
    ...definitions,
    tools: definitions.tools.filter((definition) => allowed.has(definition.name)),
  };
}

function extractFirstText(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const result = output as { content?: unknown };
  if (!Array.isArray(result.content)) return null;
  for (const part of result.content) {
    if (
      part &&
      typeof part === 'object' &&
      'text' in part &&
      typeof (part as { text: unknown }).text === 'string'
    ) {
      return (part as { text: string }).text.trim();
    }
  }
  return null;
}

function appendDiagnosticToOutput(output: unknown, hint: string): unknown {
  if (!output || typeof output !== 'object') return output;
  const result = output as { content?: unknown; isError?: unknown };
  if (!Array.isArray(result.content)) return output;
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: 'text' as const,
        text: `\n[safety diagnostic] ${hint}`,
      },
    ],
  };
}

function summarizeMcpOutput(toolName: string, output: unknown): string {
  if (!output || typeof output !== 'object') return `${toolName} returned a result`;
  const result = output as { content?: unknown; isError?: unknown };
  const prefix = result.isError ? `${toolName} failed` : `${toolName} completed`;
  if (!Array.isArray(result.content)) return prefix;
  const firstText = result.content
    .map((part) =>
      part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
        ? part.text
        : ''
    )
    .find((text) => text.trim().length > 0);
  if (!firstText) return prefix;
  const clean = firstText.replace(/\s+/g, ' ').trim();
  return `${prefix}: ${clean.slice(0, 180)}${clean.length > 180 ? '...' : ''}`;
}

function wrapMcpTools(tools: ToolSet, callbacks: ToolRunnerCallbacks): ToolSet {
  const wrapped: ToolSet = {};
  for (const [toolName, mcpTool] of Object.entries(tools)) {
    const execute = mcpTool.execute;
    if (!execute) {
      throw new Error(`MCP tool "${toolName}" does not provide an execute function.`);
    }
    wrapped[toolName] = {
      ...mcpTool,
      execute: async (args, options) => {
        callbacks.onAgentStatus?.({
          agent: 'reasoner',
          state: 'tool',
          toolName,
          message: `MCP: ${toolName}`,
        });
        const start = Date.now();
        const stepNum = callbacks.nextStep();

        // SAFETY LAYER 1: pre-flight Cypher validation. Only applies to
        // read-cypher; rejects known fabricated property names / wrong
        // relationship directions / Hebrew literals before they hit Neo4j.
        if (
          safetyEnabled() &&
          toolName === 'read-cypher' &&
          args &&
          typeof args === 'object' &&
          'cypher' in args &&
          typeof (args as { cypher: unknown }).cypher === 'string'
        ) {
          const verdict = await preflightCypherAsync((args as { cypher: string }).cypher);
          if (!verdict.ok) {
            const message = formatVerdictForAgent(verdict);
            const durationMs = Date.now() - start;
            callbacks.onStepTrace?.({
              step: stepNum,
              toolName,
              toolInput: args,
              summary: `read-cypher rejected: ${verdict.reason}`,
              evidenceIds: [],
              durationMs,
            });
            void callbacks.turnLogger?.logToolCall({
              step: stepNum,
              name: toolName,
              input: args,
              output: { content: [{ type: 'text', text: message }], isError: true },
              durationMs,
              error: verdict.reason,
            });
            return {
              isError: true,
              content: [{ type: 'text' as const, text: message }],
            };
          }
        }

        try {
          let output = await execute(args, options);
          const durationMs = Date.now() - start;

          // SAFETY LAYER 2: empty-result diagnostic. If read-cypher returned
          // [] AND the query looks like a literal-caseId match, probe the
          // graph to see if the value is actually a sourceId / caseNumber /
          // caseName fragment, and append a hint to the result.
          if (
            safetyEnabled() &&
            toolName === 'read-cypher' &&
            args &&
            typeof args === 'object' &&
            'cypher' in args &&
            typeof (args as { cypher: unknown }).cypher === 'string'
          ) {
            const text = extractFirstText(output);
            if (text === '[]' || text === '[\n]') {
              try {
                await connectNeo4j();
                const session = createSession();
                try {
                  const hint = await diagnoseEmptyCaseQuery(
                    (args as { cypher: string }).cypher,
                    session
                  );
                  if (hint) {
                    output = appendDiagnosticToOutput(output, hint);
                  }
                } finally {
                  await session.close();
                }
              } catch {
                // diagnostic is best-effort; never fail the tool call
              }
            }
          }
          const step: StepTrace = {
            step: stepNum,
            toolName,
            toolInput: args,
            summary: summarizeMcpOutput(toolName, output),
            evidenceIds: [],
            durationMs,
          };
          callbacks.onStepTrace?.(step);
          void callbacks.turnLogger?.logToolCall({
            step: stepNum,
            name: toolName,
            input: args,
            output,
            durationMs,
          });
          return output;
        } catch (err) {
          const errorResult = toToolErrorResult(toolName, err);
          const durationMs = Date.now() - start;
          callbacks.onAgentStatus?.({
            agent: 'reasoner',
            state: 'error',
            toolName,
            message: `MCP: ${toolName} failed`,
          });
          callbacks.onStepTrace?.({
            step: stepNum,
            toolName,
            toolInput: args,
            summary: `${toolName} failed: ${errorResult.error.message}`,
            evidenceIds: [],
            durationMs,
          });
          void callbacks.turnLogger?.logToolCall({
            step: stepNum,
            name: toolName,
            input: args,
            output: errorResult,
            durationMs,
            error: errorResult.error.message,
          });
          return {
            isError: true,
            content: [{ type: 'text' as const, text: errorResult.error.message }],
          };
        }
      },
    };
  }
  return wrapped;
}

async function createNeo4jMcpClient(config: Neo4jMcpConfig): Promise<MCPClient> {
  if (config.transport.type === 'http') {
    return createMCPClient({
      name: 'case-graph-reasoner',
      transport: {
        type: 'http',
        url: config.transport.url,
        headers: config.transport.headers,
        redirect: 'error',
      },
    });
  }

  return createMCPClient({
    name: 'case-graph-reasoner',
    transport: new Experimental_StdioMCPTransport({
      command: config.transport.command,
      args: config.transport.args,
      env: config.transport.env,
      cwd: process.cwd(),
    }),
  });
}

export async function buildNeo4jMcpToolRuntime(
  callbacks: ToolRunnerCallbacks,
  env: Env = process.env
): Promise<McpToolRuntime> {
  const config = resolveNeo4jMcpConfig(env);
  const client = await createNeo4jMcpClient(config);
  try {
    const definitions = await client.listTools();
    const filteredDefinitions = filterToolDefinitions(definitions, config.allowedTools);
    if (filteredDefinitions.tools.length === 0) {
      const available = definitions.tools.map((toolDef) => toolDef.name).sort().join(', ');
      throw new Error(
        `Neo4j MCP server exposed no allowed tools. Allowed: ${config.allowedTools.join(
          ', '
        )}. Available: ${available || 'none'}.`
      );
    }
    const tools = client.toolsFromDefinitions(filteredDefinitions) as ToolSet;
    return {
      tools: wrapMcpTools(tools, callbacks),
      close: () => client.close(),
      toolNames: Object.keys(tools),
      serverInfo: client.serverInfo,
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
