'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useEffect, useRef } from 'react';
import { MessageBubble } from '@/components/message-bubble';
import { AgentStatusIndicator } from '@/components/agent-status-indicator';
import type { AgentStatusEvent, StreamUIMessage } from '@/types/stream.types';
import { isAgentStatusEvent } from '@/types/stream.guards';
import {
  containerStyle,
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
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { messages, sendMessage, status, stop, error } =
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

  useEffect(() => {
    if (status === 'ready') setAgentStatus(null);
  }, [status]);

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
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} style={formStyle}>
        <AgentStatusIndicator status={agentStatus} />
        <div style={inputWrapperStyle}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask about a case..."
            disabled={isLoading}
            style={focused ? inputFocusStyle : inputStyle}
          />
          {isLoading ? (
            <button type="button" onClick={stop} style={stopButtonStyle} title="Stop">
              ■
            </button>
          ) : (
            <button
              type="submit"
              disabled={status !== 'ready' || !input.trim()}
              style={status !== 'ready' || !input.trim() ? iconButtonDisabledStyle : iconButtonStyle}
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
