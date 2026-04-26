import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectNeo4j, closeNeo4j, createSession } from '@/db/neo4j';
import { ensureGraphSchema } from '@/pipeline/schema';
import { writeReadinessCohorts } from '@/pipeline/analytics/writeReadinessCohorts';
import { writeSignals } from '@/pipeline/analytics/writeSignals';
import { computeSimilarityEdges } from '@/pipeline/similarity';
import { createLogger } from '@/utils/logger';

const logger = createLogger('load-test-graph');

function assertTestGraphLoadAllowed(): void {
  const database = process.env.NEO4J_DATABASE?.trim() ?? '';
  const allowOverride = process.env.ALLOW_TEST_GRAPH_LOAD === 'true';
  const isTestEnv = process.env.NODE_ENV === 'test';
  const isTestDatabase = database.endsWith('_test');

  if (!isTestEnv || (!isTestDatabase && !allowOverride)) {
    throw new Error(
      'Refusing to load test graph outside an isolated test context. Set NODE_ENV=test and use NEO4J_DATABASE ending with "_test", or set ALLOW_TEST_GRAPH_LOAD=true for an explicit local override (recommended only with an isolated Neo4j instance).'
    );
  }
}

function splitStatements(cypher: string): string[] {
  return cypher
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function loadTestGraph(fixturePath: string): Promise<void> {
  assertTestGraphLoadAllowed();
  await ensureGraphSchema();
  await connectNeo4j();
  const session = createSession();
  try {
    await session.run('MATCH (n) DETACH DELETE n');
    const cypher = readFileSync(resolve(fixturePath), 'utf8');
    for (const statement of splitStatements(cypher)) {
      await session.run(statement);
    }
    await writeSignals(session);
    await writeReadinessCohorts(session);
    await computeSimilarityEdges(session);
  } finally {
    await session.close();
  }
}

if (require.main === module) {
  const fixturePath =
    process.argv[2] ?? resolve(process.cwd(), 'tests', 'fixtures', 'readiness-fixture.cypher');
  loadTestGraph(fixturePath)
    .catch((error) => {
      logger.error('failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    })
    .finally(() => closeNeo4j());
}
