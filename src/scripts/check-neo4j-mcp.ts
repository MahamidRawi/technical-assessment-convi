import { buildNeo4jMcpToolRuntime } from '@/tools/mcpNeo4j';

async function main(): Promise<void> {
  const runtime = await buildNeo4jMcpToolRuntime({
    nextStep: () => 0,
  });
  try {
    console.log(
      `Connected to Neo4j MCP server ${runtime.serverInfo.name}@${runtime.serverInfo.version}`
    );
    console.log(`Exposed agent tools: ${runtime.toolNames.join(', ')}`);
  } finally {
    await runtime.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
