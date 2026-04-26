import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCurrentChatRequest } from '@/app/api/chat/request';

const validMessage = {
  id: 'msg-1',
  role: 'user',
  parts: [{ type: 'text', text: 'When is CASE-1 ready?' }],
};

test('valid single user message accepted', () => {
  const messages = parseCurrentChatRequest({ message: validMessage });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, 'user');
  assert.equal(messages[0]?.parts[0]?.type, 'text');
});

test('system message rejected', () => {
  assert.throws(() =>
    parseCurrentChatRequest({ message: { ...validMessage, role: 'system' } })
  );
});

test('assistant message rejected', () => {
  assert.throws(() =>
    parseCurrentChatRequest({ message: { ...validMessage, role: 'assistant' } })
  );
});

test('mixed history messages rejected', () => {
  assert.throws(() =>
    parseCurrentChatRequest({
      messages: [
        validMessage,
        { ...validMessage, id: 'msg-2', role: 'assistant' },
      ],
    })
  );
});

test('unsupported content parts rejected', () => {
  assert.throws(() =>
    parseCurrentChatRequest({
      message: {
        ...validMessage,
        parts: [{ type: 'file', mediaType: 'application/pdf', url: 'file.pdf' }],
      },
    })
  );
});
