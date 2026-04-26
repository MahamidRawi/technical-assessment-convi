import neo4j, { type Driver, type Session, type Record as Neo4jRecord } from 'neo4j-driver';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Neo4j');

let driver: Driver | null = null;

function buildBoltFallbackUri(uri: string): string | null {
  if (uri.startsWith('neo4j://')) {
    return `bolt://${uri.slice('neo4j://'.length)}`;
  }
  if (uri.startsWith('neo4j+s://')) {
    return `bolt+s://${uri.slice('neo4j+s://'.length)}`;
  }
  if (uri.startsWith('neo4j+ssc://')) {
    return `bolt+ssc://${uri.slice('neo4j+ssc://'.length)}`;
  }
  return null;
}

function isRoutingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('No routing servers available') ||
    message.includes('Could not perform discovery') ||
    message.includes('routing table')
  );
}

export async function connectNeo4j(): Promise<Driver> {
  if (driver) {
    return driver;
  }

  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri) throw new Error('NEO4J_URI environment variable is not set');
  if (!user) throw new Error('NEO4J_USER environment variable is not set');
  if (!password) throw new Error('NEO4J_PASSWORD environment variable is not set');

  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      maxConnectionLifetime: 30 * 60 * 1000,
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 60000,
    });

    const session = driver.session();
    await session.run('RETURN 1');
    await session.close();

    logger.log('Connected successfully:', uri);
    return driver;
  } catch (error: unknown) {
    const fallbackUri = buildBoltFallbackUri(uri);
    if (fallbackUri && isRoutingTableError(error)) {
      logger.warn('Routing discovery failed, retrying with direct Bolt URI');
      await driver?.close();
      driver = null;
      try {
        driver = neo4j.driver(fallbackUri, neo4j.auth.basic(user, password), {
          maxConnectionLifetime: 30 * 60 * 1000,
          maxConnectionPoolSize: 50,
          connectionAcquisitionTimeout: 60000,
        });
        const fallbackSession = driver.session();
        await fallbackSession.run('RETURN 1');
        await fallbackSession.close();
        logger.log('Connected successfully:', fallbackUri);
        return driver;
      } catch (fallbackError: unknown) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        logger.error('Connection failed:', fallbackMessage);
        throw fallbackError;
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error('Connection failed:', message);
    throw error;
  }
}

export async function getNeo4jDriver(): Promise<Driver> {
  if (!driver) {
    return connectNeo4j();
  }
  return driver;
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
    logger.log('Disconnected');
  }
}

export const closeNeo4jDriver = closeNeo4j;

export function createSession(): Session {
  if (!driver) {
    throw new Error('Neo4j driver not initialized. Call connectNeo4j() first.');
  }
  const database = process.env.NEO4J_DATABASE?.trim();
  return database ? driver.session({ database }) : driver.session();
}

export async function runCypher(
  cypher: string,
  params?: Record<string, unknown>
): Promise<Neo4jRecord[]> {
  const session = createSession();
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}
