'use client';

import React, { useState } from 'react';
import type { AgentName } from '@/types/stream.types';
import { AGENT_ICONS } from '@/components/agent-icons';
import { TOOL_LABELS } from '@/constants/tool-labels';
import { StateBadge } from './tool-call/state-badge';
import { ResponseContent } from './tool-call/response-content';
import { SubToolList } from './tool-call/sub-tool-list';
import { ChevronIcon } from './tool-call/chevron-icon';
import type { SubToolEvent } from './tool-call/types';

export type { SubToolEvent };

interface ToolCallAccordionProps {
  toolName: string;
  state: string;
  input: unknown;
  output: unknown;
  errorText?: string;
  subToolEvents?: SubToolEvent[];
}

const AGENT_COLORS: Record<AgentName, string> = { reasoner: '#3b82f6' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getInputText(input: unknown): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  if (isRecord(input) && 'query' in input) {
    return String(input.query);
  }
  return JSON.stringify(input);
}

export function ToolCallAccordion({
  toolName,
  state,
  input,
  output,
  errorText,
  subToolEvents,
}: ToolCallAccordionProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const label = TOOL_LABELS[toolName] ?? toolName;
  const agentColor = AGENT_COLORS.reasoner;
  const AgentIcon = AGENT_ICONS.reasoner;

  const inputText = getInputText(input);
  const preview = inputText.length > 80 ? `${inputText.slice(0, 80)}…` : inputText;

  return (
    <div
      style={{
        borderLeft: `3px solid ${agentColor}`,
        borderRadius: '6px',
        backgroundColor: '#fafafa',
        overflow: 'hidden',
      }}
    >
      <style>{`@keyframes agent-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          padding: '8px 12px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: '13px',
          color: '#374151',
          textAlign: 'left',
        }}
      >
        <ChevronIcon open={isOpen} />
        {AgentIcon && <AgentIcon size={14} color={agentColor} />}
        <span style={{ fontWeight: 600 }}>{label}</span>
        {preview && (
          <span
            style={{
              color: '#9ca3af',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {preview}
          </span>
        )}
        <StateBadge state={state} />
      </button>

      {isOpen && (
        <div style={{ padding: '8px 12px 12px', borderTop: '1px solid #e5e7eb' }}>
          {inputText && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>
                Query:
              </div>
              <div
                style={{
                  backgroundColor: '#f3f4f6',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '13px',
                  whiteSpace: 'pre-wrap',
                  lineHeight: '1.5',
                }}
              >
                {inputText}
              </div>
            </div>
          )}
          {subToolEvents && subToolEvents.length > 0 && <SubToolList events={subToolEvents} />}
          <ResponseContent state={state} output={output} errorText={errorText} />
        </div>
      )}
    </div>
  );
}
