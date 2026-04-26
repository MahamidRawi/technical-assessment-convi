'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import type { StepTrace } from '@/types/trace.types';

const NODE_COLORS: Record<string, string> = {
  Case: '#3b82f6',
  Document: '#0ea5e9',
  Communication: '#8b5cf6',
  Contact: '#f59e0b',
  ActivityEvent: '#10b981',
  StageEvent: '#14b8a6',
  ReadinessSignal: '#ef4444',
  Tool: '#6b7280',
};

interface NodeDef {
  data: { id: string; label: string; type: string };
}

interface EdgeDef {
  data: { id: string; source: string; target: string; label: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inferSeedCaseId(input: unknown): string | null {
  if (!isRecord(input)) return null;
  const id = input.caseId;
  return typeof id === 'string' ? id : null;
}

export function SubgraphView({ step }: { step: StepTrace }): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<{ destroy?: () => void } | null>(null);

  const elements = useMemo(() => {
    const nodes: NodeDef[] = [];
    const edges: EdgeDef[] = [];
    const seedCaseId = inferSeedCaseId(step.toolInput);
    const toolNodeId = `tool-${step.step}`;
    nodes.push({
      data: { id: toolNodeId, label: step.toolName, type: 'Tool' },
    });
    if (seedCaseId) {
      nodes.push({ data: { id: `Case:${seedCaseId}`, label: seedCaseId, type: 'Case' } });
      edges.push({
        data: {
          id: `${toolNodeId}->seed`,
          source: toolNodeId,
          target: `Case:${seedCaseId}`,
          label: 'on',
        },
      });
    }
    const seen = new Set<string>(nodes.map((n) => n.data.id));
    for (const ev of step.evidenceIds) {
      const nodeId = `${ev.sourceType}:${ev.sourceId}`;
      if (!seen.has(nodeId)) {
        nodes.push({ data: { id: nodeId, label: ev.label, type: ev.sourceType } });
        seen.add(nodeId);
      }
      const sourceId = seedCaseId ? `Case:${seedCaseId}` : toolNodeId;
      edges.push({
        data: {
          id: `${sourceId}->${nodeId}-${edges.length}`,
          source: sourceId,
          target: nodeId,
          label: 'returned',
        },
      });
    }
    return [...nodes, ...edges];
  }, [step]);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    void (async () => {
      const cytoscape = (await import('cytoscape')).default;
      if (cancelled || !containerRef.current) return;
      cyRef.current?.destroy?.();
      const cy = cytoscape({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (ele: { data: (k: string) => string }): string =>
                NODE_COLORS[ele.data('type')] ?? '#6b7280',
              label: 'data(label)',
              'font-size': 9,
              color: '#111827',
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 4,
              width: 18,
              height: 18,
              'text-wrap': 'ellipsis',
              'text-max-width': '120px',
            },
          },
          {
            selector: 'edge',
            style: {
              width: 1,
              'line-color': '#d1d5db',
              'target-arrow-color': '#d1d5db',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              label: 'data(label)',
              'font-size': 8,
              color: '#9ca3af',
              'text-rotation': 'autorotate',
            },
          },
        ],
        layout: { name: 'concentric', minNodeSpacing: 35, padding: 8 },
        userZoomingEnabled: false,
        userPanningEnabled: false,
        autoungrabify: true,
      });
      cyRef.current = cy;
    })();
    return () => {
      cancelled = true;
      cyRef.current?.destroy?.();
    };
  }, [elements]);

  if (elements.length <= 1) return null;

  return (
    <div style={{ marginTop: '4px' }}>
      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '2px' }}>Touched subgraph</div>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '180px',
          backgroundColor: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '4px',
        }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px', fontSize: '10px', color: '#6b7280' }}>
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <span key={type} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: color }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
