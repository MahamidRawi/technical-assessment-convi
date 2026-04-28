import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentToolMode } from '@/tools/toolMode';
import { resolveNeo4jMcpConfig } from '@/tools/mcpNeo4j';

test('agent defaults to MCP tool mode', () => {
  assert.equal(getAgentToolMode({}), 'mcp');
});

test('agent can opt into legacy atomic tool mode', () => {
  assert.equal(getAgentToolMode({ AGENT_TOOL_MODE: 'atomic' }), 'atomic');
});

test('Neo4j MCP stdio config maps NEO4J_USER to official NEO4J_USERNAME', () => {
  const config = resolveNeo4jMcpConfig({
    NEO4J_URI: 'neo4j://localhost:7687',
    NEO4J_USER: 'neo4j',
    NEO4J_PASSWORD: 'password',
  });
  assert.equal(config.transport.type, 'stdio');
  if (config.transport.type === 'stdio') {
    assert.equal(config.transport.command, 'neo4j-mcp');
    assert.equal(config.transport.env.NEO4J_USERNAME, 'neo4j');
    assert.equal(config.transport.env.NEO4J_READ_ONLY, 'true');
  }
  assert.deepEqual(config.allowedTools, ['get-schema', 'read-cypher']);
});

test('Neo4j MCP config refuses write tools by default', () => {
  assert.throws(
    () =>
      resolveNeo4jMcpConfig({
        MCP_NEO4J_ALLOWED_TOOLS: 'get-schema,write-cypher',
      }),
    /Refusing to expose write-capable MCP tools/
  );
});
