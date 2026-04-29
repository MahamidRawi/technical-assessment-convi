import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UIMessage } from 'ai';
import { z } from 'zod';

const messagePartSchema = z.object({
  type: z.string().min(1).max(120),
}).passthrough();

const persistedMessageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(['user', 'assistant']),
  metadata: z.unknown().optional(),
  parts: z.array(messagePartSchema).min(1).max(300),
});

/** Max messages accepted in JSON on disk and via CONVERSATION_HISTORY_MAX_MESSAGES (ceiling). */
const HISTORY_FILE_MAX_MESSAGES = 2000;

const historyFileSchema = z
  .object({
    version: z.literal(1),
    messages: z.array(persistedMessageSchema).max(HISTORY_FILE_MAX_MESSAGES),
  })
  .strict();

let historyWriteQueue: Promise<unknown> = Promise.resolve();

export function getConversationHistoryPath(): string {
  return (
    process.env.CONVERSATION_HISTORY_PATH ??
    path.join(process.cwd(), '.cache', 'conversation-history.json')
  );
}

function getMaxMessages(): number {
  const parsed = Number(process.env.CONVERSATION_HISTORY_MAX_MESSAGES ?? 20);
  if (!Number.isFinite(parsed) || parsed < 2) return 20;
  return Math.min(Math.floor(parsed), HISTORY_FILE_MAX_MESSAGES);
}

function trimHistory(messages: UIMessage[]): UIMessage[] {
  return messages.slice(-getMaxMessages());
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readHistoryFile(filePath: string): Promise<UIMessage[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = historyFileSchema.parse(JSON.parse(raw));
    return parsed.messages as UIMessage[];
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }
}

async function writeHistoryFile(
  messages: UIMessage[],
  filePath: string
): Promise<void> {
  await ensureParentDir(filePath);
  const safeMessages = trimHistory(messages);
  const payload = JSON.stringify(
    { version: 1, messages: safeMessages },
    null,
    2
  );
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${payload}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function withHistoryLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = historyWriteQueue.then(operation, operation);
  historyWriteQueue = run.catch(() => undefined);
  return run;
}

export async function readConversationHistory(
  filePath = getConversationHistoryPath()
): Promise<UIMessage[]> {
  return readHistoryFile(filePath);
}

export async function replaceConversationHistory(
  messages: UIMessage[],
  filePath = getConversationHistoryPath()
): Promise<UIMessage[]> {
  return withHistoryLock(async () => {
    const safeMessages = trimHistory(
      historyFileSchema.parse({ version: 1, messages }).messages as UIMessage[]
    );
    await writeHistoryFile(safeMessages, filePath);
    return safeMessages;
  });
}

export async function appendConversationMessage(
  message: UIMessage,
  filePath = getConversationHistoryPath()
): Promise<UIMessage[]> {
  return withHistoryLock(async () => {
    const messages = await readHistoryFile(filePath);
    const safeMessage = persistedMessageSchema.parse(message) as UIMessage;
    const withoutDuplicate = messages.filter((stored) => stored.id !== safeMessage.id);
    const nextMessages = trimHistory([...withoutDuplicate, safeMessage]);
    await writeHistoryFile(nextMessages, filePath);
    return nextMessages;
  });
}

export async function appendAssistantTextMessage(
  text: string,
  filePath = getConversationHistoryPath()
): Promise<UIMessage[]> {
  const trimmed = text.trim();
  if (!trimmed) return readConversationHistory(filePath);

  return appendConversationMessage(
    {
      id: `assistant-${randomUUID()}`,
      role: 'assistant',
      parts: [{ type: 'text', text: trimmed }],
    },
    filePath
  );
}

export async function clearConversationHistory(
  filePath = getConversationHistoryPath()
): Promise<void> {
  await withHistoryLock(async () => {
    await writeHistoryFile([], filePath);
  });
}
