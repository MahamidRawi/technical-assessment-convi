'use client';

import type { AgentStatusEvent } from '@/types/stream.types';

export function AgentStatusIndicator({
  status,
}: {
  status: AgentStatusEvent | null;
}): React.JSX.Element | null {
  if (!status || (status.state !== 'working' && status.state !== 'tool')) return null;

  const label = status.toolName ?? status.message;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 14px',
        marginBottom: '8px',
        borderRadius: '999px',
        fontSize: '12px',
        color: '#000000',
        width: 'fit-content',
        maxWidth: '100%',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}
    >
      <style>{`
        @keyframes agent-dot-bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-4px); }
        }
      `}</style>

      <span style={{ display: 'inline-flex', gap: '2px' }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              display: 'inline-block',
              width: 3,
              height: 3,
              borderRadius: '50%',
              backgroundColor: '#000000',
              animation: `agent-dot-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
            }}
          />
        ))}
      </span>

      <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
    </div>
  );
}
