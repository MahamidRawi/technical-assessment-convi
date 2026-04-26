import React from 'react';

const mutedStyle: React.CSSProperties = {
  color: '#9ca3af',
  fontStyle: 'italic',
  fontSize: '13px',
};

export function ResponseContent({
  state,
  output,
  errorText,
}: {
  state: string;
  output: unknown;
  errorText?: string;
}): React.JSX.Element | null {
  if (state === 'input-streaming') return <p style={mutedStyle}>Sending request...</p>;
  if (state === 'input-available' || state === 'approval-responded') {
    return <p style={mutedStyle}>Processing...</p>;
  }
  if (state === 'approval-requested') {
    return <p style={{ ...mutedStyle, color: '#d97706' }}>Awaiting approval...</p>;
  }
  if (state === 'output-available') {
    return (
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>Response:</div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.5' }}>
          {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
        </div>
      </div>
    );
  }
  if (state === 'output-error') {
    return (
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#dc2626', marginBottom: '4px' }}>Error:</div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', color: '#dc2626' }}>
          {errorText ?? 'Unknown error'}
        </div>
      </div>
    );
  }
  if (state === 'output-denied') {
    return <p style={{ color: '#dc2626', fontSize: '13px' }}>Request denied</p>;
  }
  return null;
}
