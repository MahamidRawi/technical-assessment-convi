import {
  type UIMessage,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import { streamCaseReasonerResponse } from '@/agents/caseReasoner';
import type { OnAgentStatus, OnReadinessDecision, OnStepTrace } from '@/types/stream.types';
import { parseCurrentChatRequest } from './request';
import { createLogger } from '@/utils/logger';
import { createTurnLogger } from '@/utils/turnLogger';

const logger = createLogger('Chat');

export const runtime = 'nodejs';
export const maxDuration = 90;

function extractUserText(messages: UIMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last) return '';
  return last.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  let messages: UIMessage[];
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    messages = parseCurrentChatRequest(body);
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const turnLogger = createTurnLogger();
  void turnLogger.logUser(extractUserText(messages));

  try {
    const stream = createUIMessageStream({
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

        void (async (): Promise<void> => {
          try {
            const text = await result.text;
            await turnLogger.logFinalResponse(text);
          } catch (err) {
            await turnLogger.logError('Failed to capture final response', err);
          } finally {
            await turnLogger.end();
          }
        })();
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
