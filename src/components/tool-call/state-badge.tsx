import React from 'react';

const badgeBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '11px',
  fontWeight: 500,
  padding: '2px 6px',
  borderRadius: '4px',
};

const pulseDotStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
  backgroundColor: '#9ca3af',
  animation: 'agent-pulse 1.5s ease-in-out infinite',
};

type BadgeSpec = { label: string; color: string; bg: string };

const STATIC_BADGES: Record<string, BadgeSpec> = {
  'approval-requested': { label: 'Awaiting approval', color: '#d97706', bg: '#fef3c7' },
  'output-available': { label: '\u2713 Done', color: '#059669', bg: '#d1fae5' },
  'output-error': { label: '\u2717 Error', color: '#dc2626', bg: '#fee2e2' },
  'output-denied': { label: 'Denied', color: '#dc2626', bg: '#fee2e2' },
};

const PENDING_STATES = new Set(['input-streaming', 'input-available', 'approval-responded']);

export function StateBadge({ state }: { state: string }): React.JSX.Element {
  if (PENDING_STATES.has(state)) {
    const label = state === 'input-streaming' ? 'Sending...' : 'Processing...';
    return (
      <span style={{ ...badgeBase, color: '#6b7280', backgroundColor: '#f3f4f6' }}>
        <span style={pulseDotStyle} />
        {label}
      </span>
    );
  }
  const spec = STATIC_BADGES[state];
  if (spec) {
    return <span style={{ ...badgeBase, color: spec.color, backgroundColor: spec.bg }}>{spec.label}</span>;
  }
  return <span style={{ ...badgeBase, color: '#6b7280', backgroundColor: '#f3f4f6' }}>{state}</span>;
}
