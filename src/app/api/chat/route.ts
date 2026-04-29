import {
  type UIMessage,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import { streamCaseReasonerResponse } from '@/agents/caseReasoner';
import {
  appendConversationMessage,
  clearConversationHistory,
  readConversationHistory,
} from '@/db/conversationHistory';
import type { OnAgentStatus, OnReadinessDecision, OnStepTrace } from '@/types/stream.types';
import { parseCurrentChatRequest } from './request';
import { createLogger } from '@/utils/logger';
import { createTurnLogger } from '@/utils/turnLogger';

const logger = createLogger('Chat');

export const maxDuration = 90;

function extractMessageText(message: UIMessage | undefined): string {
  if (!message) return '';
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

export async function GET(): Promise<Response> {
  try {
    const messages = await readConversationHistory();
    return Response.json({ messages });
  } catch (error: unknown) {
    logger.error('Failed to read conversation history', error);
    return Response.json({ error: 'Failed to read conversation history' }, { status: 500 });
  }
}

export async function DELETE(): Promise<Response> {
  try {
    await clearConversationHistory();
    return Response.json({ messages: [] });
  } catch (error: unknown) {
    logger.error('Failed to clear conversation history', error);
    return Response.json({ error: 'Failed to clear conversation history' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  let messages: UIMessage[];
  let incomingMessage: UIMessage;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const [message] = parseCurrentChatRequest(body);
    if (!message) return Response.json({ error: 'Invalid request body' }, { status: 400 });
    incomingMessage = message;
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    messages = await appendConversationMessage(incomingMessage);
  } catch (error: unknown) {
    logger.error('Failed to persist incoming message', error);
    return Response.json({ error: 'Failed to persist conversation history' }, { status: 500 });
  }

  const turnLogger = createTurnLogger();
  void turnLogger.logUser(extractMessageText(incomingMessage));

  try {
    const stream = createUIMessageStream({
      originalMessages: messages,
      onFinish: async ({ responseMessage }) => {
        try {
          await appendConversationMessage(responseMessage);
          await turnLogger.logFinalResponse(extractMessageText(responseMessage));
        } catch (error: unknown) {
          await turnLogger.logError('Failed to persist final assistant message', error);
        } finally {
          await turnLogger.end();
        }
      },
      execute: async ({ writer }) => {
        const onAgentStatus: OnAgentStatus = (event) => {
          writer.write({ type: 'data-agentStatus', data: event, transient: true });
          if (event.toolName) {
            writer.write({ type: 'data-subToolCall', data: event });
          }
        };

        const onStepTrace: OnStepTrace = (step) => {
          writer.write({ type: 'data-stepTrace', data: step });
        };

        const onReadinessDecision: OnReadinessDecision = (artifact) => {
          writer.write({ type: 'data-readinessDecisionArtifact', data: artifact });
        };

        const result = await streamCaseReasonerResponse(
          messages,
          onAgentStatus,
          onStepTrace,
          onReadinessDecision,
          turnLogger
        );

        writer.merge(result.toUIMessageStream());
      },
      onError: (error) => {
        logger.error('Stream failed', error);
        void turnLogger.logError('Stream failed', error).then(() => turnLogger.end());
        return 'Internal server error';
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error: unknown) {
    logger.error('Request failed', error);
    await turnLogger.logError('Request failed', error);
    await turnLogger.end();
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
