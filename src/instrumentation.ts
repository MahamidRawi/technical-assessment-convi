import { generateText } from 'ai';
import { connectNeo4j } from '@/db/neo4j';
import { createLogger } from '@/utils/logger';
import { getLanguageModel } from '@/llm/provider';

const logger = createLogger('Server');
const langfuseLogger = createLogger('Langfuse');
const llmLogger = createLogger('LLM');
const neo4jLogger = createLogger('Neo4j');

async function registerLangfuse(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    langfuseLogger.log('Keys not set — tracing disabled');
    return;
  }

  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { LangfuseSpanProcessor } = await import('@langfuse/otel');

  const sdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
        environment: process.env.NODE_ENV || 'development',
        exportMode: 'immediate',
      }),
    ],
  });

  sdk.start();
  langfuseLogger.log('OpenTelemetry + Langfuse v5 tracing enabled');
}

async function checkLLMHealth(): Promise<boolean> {
  if (process.env.SKIP_LLM_HEALTH_CHECK === 'true') {
    llmLogger.log('Health check: skipped (SKIP_LLM_HEALTH_CHECK=true)');
    return true;
  }
  try {
    await generateText({
      model: getLanguageModel(),
      prompt: 'ping',
      maxOutputTokens: 16,
    });
    llmLogger.log('Health check: passed');
    return true;
  } catch (error: unknown) {
    llmLogger.warn(
      'Health check failed:',
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

async function checkNeo4jHealth(): Promise<boolean> {
  if (process.env.SKIP_NEO4J_HEALTH_CHECK === 'true') {
    neo4jLogger.log('Health check: skipped (SKIP_NEO4J_HEALTH_CHECK=true)');
    return true;
  }

  if (!process.env.NEO4J_URI) {
    neo4jLogger.log('Health check: skipped (NEO4J_URI not set)');
    return true;
  }

  try {
    await connectNeo4j();
    neo4jLogger.log('Health check: passed');
    return true;
  } catch (error: unknown) {
    neo4jLogger.warn(
      'Health check failed:',
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    await registerLangfuse();
    const [llmHealthy, neo4jHealthy] = await Promise.all([
      checkLLMHealth(),
      checkNeo4jHealth(),
    ]);

    const status = [
      `LLM: ${llmHealthy ? 'True' : 'False'}`,
      neo4jHealthy ? `Neo4j: True` : `Neo4j: False`,
    ]
      .filter((s) => !s.includes('False') || neo4jHealthy === false)
      .join(', ');

    logger.log(
      'Agentic reasoner initialized — ' + status
    );
  } catch (error) {
    logger.error('Startup error:', error);
  }
}
