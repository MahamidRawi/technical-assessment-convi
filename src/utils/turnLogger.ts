import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'turns.log');

let dirReady: Promise<void> | null = null;

function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = mkdir(LOG_DIR, { recursive: true }).then(() => undefined);
  }
  return dirReady;
}

async function append(text: string): Promise<void> {
  await ensureDir();
  await appendFile(LOG_FILE, text, 'utf8');
}

function fmt(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export interface ToolCallLog {
  step: number;
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  error?: string;
}

export interface TurnLogger {
  turnId: string;
  logUser(text: string): Promise<void>;
  logToolCall(call: ToolCallLog): Promise<void>;
  logFinalResponse(text: string): Promise<void>;
  logError(message: string, err?: unknown): Promise<void>;
  end(): Promise<void>;
}

export function createTurnLogger(): TurnLogger {
  const turnId = randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();
  const queue: Promise<void>[] = [];

  const enqueue = (p: Promise<void>): Promise<void> => {
    queue.push(p);
    return p;
  };

  const header = `\n=== TURN ${turnId} — ${startedAt} ===\n`;
  enqueue(append(header));

  return {
    turnId,
    logUser(text: string): Promise<void> {
      return enqueue(append(`\n[USER]\n${text}\n`));
    },
    logToolCall(call: ToolCallLog): Promise<void> {
      const lines = [
        `\n[TOOL #${call.step}] ${call.name}  (${call.durationMs}ms)`,
        `  input:  ${fmt(call.input)}`,
      ];
      if (call.error) {
        lines.push(`  error:  ${call.error}`);
      } else {
        lines.push(`  output: ${fmt(call.output)}`);
      }
      lines.push('');
      return enqueue(append(lines.join('\n')));
    },
    logFinalResponse(text: string): Promise<void> {
      return enqueue(append(`\n[RESPONSE]\n${text}\n`));
    },
    logError(message: string, err?: unknown): Promise<void> {
      const detail = err instanceof Error ? err.stack ?? err.message : err ? fmt(err) : '';
      return enqueue(append(`\n[ERROR] ${message}${detail ? `\n${detail}` : ''}\n`));
    },
    async end(): Promise<void> {
      enqueue(append(`\n=== END TURN ${turnId} ===\n`));
      await Promise.allSettled(queue);
    },
  };
}
