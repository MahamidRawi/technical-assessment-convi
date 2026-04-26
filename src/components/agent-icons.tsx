'use client';

import type { AgentName } from '@/types/stream.types';

interface IconProps {
  size?: number;
  color?: string;
}

export function ReasonerIcon({
  size = 16,
  color = 'currentColor',
}: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 2.5c1.5 0 2.5 1 2.5 2.5v1c0 1.5 1 2.5 2.5 2.5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 2.5c-1.5 0-2.5 1-2.5 2.5v1c0 1.5-1 2.5-2.5 2.5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="10" r="3.5" stroke={color} strokeWidth="1.5" />
      <path
        d="M6 13.5c-1 0-1.5.5-1.5 1.5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M10 13.5c1 0 1.5.5 1.5 1.5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const AGENT_ICONS: Record<
  AgentName,
  React.ComponentType<IconProps>
> = {
  reasoner: ReasonerIcon,
};
