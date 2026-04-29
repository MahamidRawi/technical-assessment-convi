import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendAssistantTextMessage,
  appendConversationMessage,
  clearConversationHistory,
  readConversationHistory,
} from '@/db/conversationHistory';
import type { UIMessage } from 'ai';

async function withTempHistory<T>(
  fn: (filePath: string) => Promise<T>
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-history-'));
  try {
    return await fn(path.join(dir, 'history.json'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function userMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  };
}

test('conversation history starts empty and appends text turns', async () => {
  await withTempHistory(async (filePath) => {
    assert.deepEqual(await readConversationHistory(filePath), []);

    await appendConversationMessage(userMessage('u-1', 'first question'), filePath);
    await appendAssistantTextMessage('first answer', filePath);

    const messages = await readConversationHistory(filePath);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, 'user');
    assert.equal(messages[1]?.role, 'assistant');
    assert.deepEqual(messages[0]?.parts, [{ type: 'text', text: 'first question' }]);
    assert.deepEqual(messages[1]?.parts, [{ type: 'text', text: 'first answer' }]);
  });
});

test('conversation history preserves assistant tool and data parts', async () => {
  await withTempHistory(async (filePath) => {
    await appendConversationMessage(
      {
        id: 'a-1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'tool-graphRead',
            toolCallId: 'tool-1',
            state: 'output-available',
            input: { cypher: 'MATCH (c:Case) RETURN c LIMIT 1' },
            output: { rowCount: 1 },
          },
          {
            type: 'data-stepTrace',
            data: { step: 1, toolName: 'graphRead', status: 'success' },
          },
          { type: 'text', text: 'Graph-backed answer' },
        ],
      },
      filePath
    );

    const [message] = await readConversationHistory(filePath);
    assert.equal(message?.role, 'assistant');
    assert.equal(message?.parts[1]?.type, 'tool-graphRead');
    assert.deepEqual(message?.parts[1], {
      type: 'tool-graphRead',
      toolCallId: 'tool-1',
      state: 'output-available',
      input: { cypher: 'MATCH (c:Case) RETURN c LIMIT 1' },
      output: { rowCount: 1 },
    });
    assert.equal(message?.parts[2]?.type, 'data-stepTrace');
  });
});

test('conversation history clear leaves an empty json database', async () => {
  await withTempHistory(async (filePath) => {
    await appendConversationMessage(userMessage('u-1', 'question'), filePath);
    await clearConversationHistory(filePath);

    assert.deepEqual(await readConversationHistory(filePath), []);

    const raw = await fs.readFile(filePath, 'utf8');
    assert.match(raw, /"version": 1/);
    assert.match(raw, /"messages": \[\]/);
  });
});
