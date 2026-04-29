import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Neo4j bootstrap');

function run(command: string): void {
  execSync(command, { stdio: 'inherit' });
}

function tryRun(command: string): boolean {
  try {
    run(command);
    return true;
  } catch {
    return false;
  }
}

async function waitForNeo4j(maxAttempts = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      run('npm run -s check:neo4j');
      return;
    } catch {
      if (attempt === maxAttempts) {
        throw new Error('Neo4j did not become healthy in time');
      }
      logger.log(`waiting for Neo4j... (${attempt}/${maxAttempts})`);
      await sleep(delayMs);
    }
  }
}

async function main(): Promise<void> {
  const composeStarted = tryRun('docker compose up -d neo4j');
  if (!composeStarted) {
    logger.log('compose start failed, trying existing Neo4j instance');
  }
  await waitForNeo4j();
  if (process.env.BOOTSTRAP_INGEST === 'true') {
    // Full bootstrap implies a clean slate. Re-applying schema is idempotent,
    // but stale nodes/edges from a prior ingest (e.g. orphaned Cases that no
    // longer exist in source Mongo, old cohort properties) would otherwise
    // persist. `npm run setup` is the "everything from A to Z" entry point;
    // we clear first so the user always gets a deterministic build.
    run('npm run -s clear');
  }
  run('npm run -s schema');
  if (process.env.BOOTSTRAP_INGEST === 'true') {
    run('npm run -s ingest');
    if (process.env.BOOTSTRAP_SKIP_VERIFY !== 'true') {
      logger.log('running verify:graph to confirm node/relationship counts and OCR coverage');
      run('npm run -s verify:graph');
    }
  } else {
    logger.log('skipping ingest (set BOOTSTRAP_INGEST=true to include data load)');
  }
  logger.log('complete');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`failed: ${message}`);
  process.exit(1);
});
