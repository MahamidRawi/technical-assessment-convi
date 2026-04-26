import React from 'react';
import type { SubToolEvent } from './types';

export function SubToolList({ events }: { events: SubToolEvent[] }): React.JSX.Element | null {
  const doneEvents = events.filter((e) => e.state === 'done' || e.state === 'error');
  if (doneEvents.length === 0) return null;

  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>
        Tools used:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {doneEvents.map((event, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              padding: '3px 8px',
              borderRadius: '4px',
              backgroundColor: event.state === 'error' ? '#fee2e2' : '#f0fdf4',
            }}
          >
            <span
              style={{
                fontFamily: 'monospace',
                fontWeight: 600,
                color: event.state === 'error' ? '#dc2626' : '#059669',
              }}
            >
              {event.toolName}
            </span>
            <span style={{ color: '#6b7280' }}>{event.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
