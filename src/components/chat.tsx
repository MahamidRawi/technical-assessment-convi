'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useEffect, useRef } from 'react';
import { MessageBubble } from '@/components/message-bubble';
import { AgentStatusIndicator } from '@/components/agent-status-indicator';
import type { AgentStatusEvent, StreamUIMessage } from '@/types/stream.types';
import { isAgentStatusEvent } from '@/types/stream.guards';
import {
  clearButtonDisabledStyle,
  clearButtonStyle,
  containerStyle,
  formToolbarStyle,
  formStyle,
  iconButtonDisabledStyle,
  iconButtonStyle,
  inputFocusStyle,
  inputStyle,
  inputWrapperStyle,
  messagesAreaStyle,
  stopButtonStyle,
} from './chat.styles';

const chatTransport = new DefaultChatTransport<StreamUIMessage>({
  prepareSendMessagesRequest: ({ messages }) => ({
    body: { message: messages[messages.length - 1] ?? null },
  }),
});

export function Chat(): React.JSX.Element {
  const [agentStatus, setAgentStatus] = useState<AgentStatusEvent | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { messages, setMessages, sendMessage, status, stop, error, clearError } =
    useChat<StreamUIMessage>({
      transport: chatTransport,
      onData: (dataPart) => {
        if (dataPart.type === 'data-agentStatus' && isAgentStatusEvent(dataPart.data)) {
          const event = dataPart.data;
          setAgentStatus(event);

          if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);

          if (event.state === 'done' || event.state === 'error') {
            statusTimeoutRef.current = setTimeout(
              () => setAgentStatus(null),
              1500
            );
          }
        }
      },
    });

  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isLoading = status === 'submitted' || status === 'streaming';
  const isInputDisabled = isLoading || historyLoading;

  useEffect(() => {
    if (status === 'ready') setAgentStatus(null);
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadHistory(): Promise<void> {
      try {
        const response = await fetch('/api/chat', {
          method: 'GET',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Failed to load conversation history');
        const data = (await response.json()) as { messages?: StreamUIMessage[] };
        if (Array.isArray(data.messages)) {
          setMessages((current) =>
            current.length === 0 ? data.messages ?? [] : current
          );
        }
      } catch (loadError: unknown) {
        if (controller.signal.aborted) return;
        setHistoryError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load conversation history'
        );
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }

    void loadHistory();
    return () => controller.abort();
  }, [setMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentStatus]);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    sendMessage({ text: trimmed });
    setInput('');
  }

  async function handleClearHistory(): Promise<void> {
    if (isLoading || isClearingHistory) return;
    setIsClearingHistory(true);
    setHistoryError(null);
    clearError();

    try {
      const response = await fetch('/api/chat', { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to clear conversation history');
      setMessages([]);
      setAgentStatus(null);
    } catch (clearHistoryError: unknown) {
      setHistoryError(
        clearHistoryError instanceof Error
          ? clearHistoryError.message
          : 'Failed to clear conversation history'
      );
    } finally {
      setIsClearingHistory(false);
      setHistoryLoading(false);
    }
  }

  return (
    <div style={containerStyle}>
      <div style={{ ...messagesAreaStyle, paddingBottom: '100px' }}>
        {messages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '40px 20px',
              userSelect: 'none',
            }}
          >
            <p style={{ margin: 0, fontSize: '22px', fontWeight: 600, color: '#111', letterSpacing: '-0.3px' }}>
              I&apos;m terrible at small talk.
            </p>
            <p style={{ margin: '8px 0 0', fontSize: '15px', color: '#888', fontWeight: 400 }}>
              You go first.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        {error && (
          <div style={{ padding: '8px 0', color: '#cc0000', fontSize: '14px' }}>
            Error: {error.message}. Please try again.
          </div>
        )}
        {historyError && (
          <div style={{ padding: '8px 0', color: '#cc0000', fontSize: '14px' }}>
            {historyError}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} style={formStyle}>
        <AgentStatusIndicator status={agentStatus} />
        <div style={formToolbarStyle}>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClearHistory()}
              disabled={isLoading || isClearingHistory}
              style={
                isLoading || isClearingHistory
                  ? clearButtonDisabledStyle
                  : clearButtonStyle
              }
              title="Clear conversation history"
            >
              Clear
            </button>
          )}
        </div>
        <div style={inputWrapperStyle}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask about a case..."
            disabled={isInputDisabled}
            style={focused ? inputFocusStyle : inputStyle}
          />
          {isLoading ? (
            <button type="button" onClick={stop} style={stopButtonStyle} title="Stop">
              ■
            </button>
          ) : (
            <button
              type="submit"
              disabled={status !== 'ready' || historyLoading || !input.trim()}
              style={
                status !== 'ready' || historyLoading || !input.trim()
                  ? iconButtonDisabledStyle
                  : iconButtonStyle
              }
              title="Send"
            >
              ↑
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
