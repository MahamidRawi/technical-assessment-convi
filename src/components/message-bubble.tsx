'use client';

import React from 'react';
import { isToolUIPart, getToolName } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolCallAccordion } from '@/components/tool-call-accordion';
import type { SubToolEvent } from '@/components/tool-call-accordion';
import { ReasoningTracePanel } from '@/components/reasoning-trace-panel';
import { ReadinessDecisionPanel } from '@/components/readiness-decision-panel';
import { TOOL_TO_AGENT } from '@/constants/tool-labels';
import type { StreamUIMessage, AgentName } from '@/types/stream.types';
import type { ReadinessDecisionArtifact, StepTrace } from '@/types/trace.types';
import {
  isAgentStatusEvent,
  isReadinessDecisionArtifact,
  isStepTrace,
} from '@/types/stream.guards';

const userBubbleStyle: React.CSSProperties = {
  alignSelf: 'flex-end',
  backgroundColor: '#0066ff',
  color: '#ffffff',
  borderRadius: '16px 16px 4px 16px',
  padding: '10px 16px',
  maxWidth: '75%',
  wordBreak: 'break-word',
};

const assistantBubbleStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  backgroundColor: '#f0f0f0',
  color: '#1a1a1a',
  borderRadius: '16px 16px 16px 4px',
  padding: '10px 16px',
  maxWidth: '75%',
  wordBreak: 'break-word',
  lineHeight: '1.5',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

function MarkdownContent({ text }: { text: string }): React.JSX.Element {
  return (
    <div dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: '20px' }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: '2px' }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote style={{ margin: '4px 0', paddingLeft: '12px', borderLeft: '3px solid #ccc', color: '#555' }}>
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code style={{ background: '#e0e0e0', borderRadius: '3px', padding: '1px 4px', fontSize: '0.9em' }}>
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre style={{ margin: '4px 0', background: '#e0e0e0', borderRadius: '6px', padding: '8px 10px', overflowX: 'auto' }}>
              {children}
            </pre>
          ),
          h1: ({ children }) => <p style={{ margin: '8px 0 4px', fontWeight: 700, fontSize: '1.15em' }}>{children}</p>,
          h2: ({ children }) => <p style={{ margin: '8px 0 4px', fontWeight: 700, fontSize: '1.1em' }}>{children}</p>,
          h3: ({ children }) => <p style={{ margin: '8px 0 4px', fontWeight: 700, fontSize: '1.05em' }}>{children}</p>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function collectSubToolsAndTrace(message: StreamUIMessage): {
  subToolsByAgent: Map<AgentName, SubToolEvent[]>;
  traceSteps: StepTrace[];
  readinessDecision: ReadinessDecisionArtifact | null;
} {
  const subToolsByAgent = new Map<AgentName, SubToolEvent[]>();
  const traceSteps: StepTrace[] = [];
  let readinessDecision: ReadinessDecisionArtifact | null = null;
  for (const part of message.parts) {
    if (part.type === 'data-subToolCall' && isAgentStatusEvent(part.data)) {
      const event = part.data;
      if (event.toolName) {
        const list = subToolsByAgent.get(event.agent) ?? [];
        list.push({ toolName: event.toolName, state: event.state, message: event.message });
        subToolsByAgent.set(event.agent, list);
      }
    } else if (part.type === 'data-stepTrace' && isStepTrace(part.data)) {
      traceSteps.push(part.data);
    } else if (
      part.type === 'data-readinessDecisionArtifact' &&
      isReadinessDecisionArtifact(part.data)
    ) {
      readinessDecision = part.data;
    }
  }
  return { subToolsByAgent, traceSteps, readinessDecision };
}

export function MessageBubble({ message }: { message: StreamUIMessage }): React.JSX.Element {
  const isUser = message.role === 'user';
  const { subToolsByAgent, traceSteps, readinessDecision } = collectSubToolsAndTrace(message);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: '12px',
      }}
    >
      <div dir="auto" style={isUser ? userBubbleStyle : assistantBubbleStyle}>
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            if (isUser) {
              return (
                <div key={index} dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                  {part.text}
                </div>
              );
            }
            return <MarkdownContent key={index} text={part.text} />;
          }
          if (isToolUIPart(part)) {
            const toolName = getToolName(part);
            const agentName = TOOL_TO_AGENT[toolName];
            const subTools = agentName ? subToolsByAgent.get(agentName) : undefined;
            return (
              <ToolCallAccordion
                key={index}
                toolName={toolName}
                state={part.state}
                input={part.state !== 'input-streaming' ? part.input : undefined}
                output={part.state === 'output-available' ? part.output : undefined}
                errorText={part.state === 'output-error' ? part.errorText : undefined}
                subToolEvents={subTools}
              />
            );
          }
          return null;
        })}
        {!isUser && readinessDecision && <ReadinessDecisionPanel artifact={readinessDecision} />}
        {!isUser && traceSteps.length > 0 && <ReasoningTracePanel steps={traceSteps} />}
      </div>
    </div>
  );
}
