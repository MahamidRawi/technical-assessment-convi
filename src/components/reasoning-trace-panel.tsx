'use client';

import React, { useState } from 'react';
import type { StepTrace } from '@/types/trace.types';
import { TOOL_LABELS } from '@/constants/tool-labels';
import { EvidenceChip } from './evidence-chip';
import { SubgraphView } from './tool-call/subgraph-view';

export function ReasoningTracePanel({ steps }: { steps: StepTrace[] }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: '#fafafa' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          padding: '6px 10px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: '12px',
          color: '#374151',
          textAlign: 'left',
        }}
      >
        <span style={{ fontWeight: 600 }}>Reasoning trace</span>
        <span style={{ color: '#6b7280' }}>
          {steps.length} step{steps.length === 1 ? '' : 's'}
        </span>
        <span style={{ marginLeft: 'auto', color: '#6b7280' }}>{open ? 'v' : '>'}</span>
      </button>
      {open && (
        <div style={{ padding: '6px 10px 10px', borderTop: '1px solid #e5e7eb' }}>
          {steps.map((s) => (
            <div key={s.step} style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', color: '#111827' }}>
                <span style={{ fontWeight: 600 }}>
                  {s.step}. {TOOL_LABELS[s.toolName] ?? s.toolName}
                </span>
                <span style={{ color: '#6b7280' }}> | {s.summary}</span>
                <span style={{ color: '#9ca3af', fontSize: '11px' }}>
                  {' | '}
                  {s.durationMs}ms
                  {typeof s.rowCount === 'number' ? ` | ${s.rowCount} row${s.rowCount === 1 ? '' : 's'}` : ''}
                </span>
              </div>
              {s.evidenceIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                  {s.evidenceIds.map((ev, i) => (
                    <EvidenceChip key={`${s.step}-${i}`} item={ev} />
                  ))}
                </div>
              )}
              {s.cypher && (
                <details style={{ marginTop: '4px' }}>
                  <summary style={{ fontSize: '11px', color: '#6b7280', cursor: 'pointer' }}>
                    Cypher
                  </summary>
                  <pre
                    style={{
                      fontSize: '11px',
                      backgroundColor: '#f3f4f6',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      overflowX: 'auto',
                      margin: '4px 0 0',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      color: '#1f2937',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {s.cypher}
                    {s.params && Object.keys(s.params).length > 0
                      ? `\n\n-- params: ${JSON.stringify(s.params)}`
                      : ''}
                  </pre>
                </details>
              )}
              {s.evidenceIds.length > 0 && (
                <details style={{ marginTop: '4px' }}>
                  <summary style={{ fontSize: '11px', color: '#6b7280', cursor: 'pointer' }}>
                    Subgraph
                  </summary>
                  <SubgraphView step={s} />
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
