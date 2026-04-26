import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTestGraph } from '@/scripts/load-test-graph';

test('loadTestGraph refuses to run outside isolated test context', async () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabase = process.env.NEO4J_DATABASE;
  const originalAllow = process.env.ALLOW_TEST_GRAPH_LOAD;

  Reflect.deleteProperty(env, 'NODE_ENV');
  Reflect.deleteProperty(env, 'NEO4J_DATABASE');
  Reflect.deleteProperty(env, 'ALLOW_TEST_GRAPH_LOAD');

  try {
    await assert.rejects(
      () => loadTestGraph('tests/fixtures/readiness-fixture.cypher'),
      /Refusing to load test graph/
    );
  } finally {
    if (originalNodeEnv === undefined) Reflect.deleteProperty(env, 'NODE_ENV');
    else env.NODE_ENV = originalNodeEnv;
    if (originalDatabase === undefined) Reflect.deleteProperty(env, 'NEO4J_DATABASE');
    else env.NEO4J_DATABASE = originalDatabase;
    if (originalAllow === undefined) Reflect.deleteProperty(env, 'ALLOW_TEST_GRAPH_LOAD');
    else env.ALLOW_TEST_GRAPH_LOAD = originalAllow;
  }
});
