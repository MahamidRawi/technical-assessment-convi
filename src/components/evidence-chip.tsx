import React from 'react';
import type { StepTrace } from '@/types/trace.types';

const BADGE_COLOR: Record<string, string> = {
  Document: '#7c3aed',
  Communication: '#0ea5e9',
  Case: '#059669',
  Contact: '#d97706',
};

export function EvidenceChip({
  item,
}: {
  item: StepTrace['evidenceIds'][number];
}): React.JSX.Element {
  return (
    <span
      title={`${item.sourceType} · ${item.sourceId}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '11px',
        padding: '2px 6px',
        borderRadius: '4px',
        backgroundColor: '#fff',
        border: '1px solid #e5e7eb',
        maxWidth: '240px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          fontSize: '9px',
          fontWeight: 600,
          color: BADGE_COLOR[item.sourceType] ?? '#6b7280',
          textTransform: 'uppercase',
        }}
      >
        {item.sourceType}
      </span>
      <span style={{ color: '#374151' }} dir="auto">
        {item.label}
      </span>
    </span>
  );
}
