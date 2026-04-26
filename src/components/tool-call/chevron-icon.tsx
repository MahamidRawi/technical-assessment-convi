import React from 'react';

export function ChevronIcon({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      style={{
        transition: 'transform 0.2s ease',
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      }}
    >
      <path
        d="M4 2l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
