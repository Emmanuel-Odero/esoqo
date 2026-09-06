import type { ReactNode } from 'react';

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'navy' | 'live' | 'draft' | 'paused';

export function Badge({
  tone = 'green',
  dot = false,
  children,
  className = '',
}: {
  tone?: Tone;
  dot?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={`pill pill-${tone} ${className}`}>
      {dot && <span className="pdot" aria-hidden="true" />}
      {children}
    </span>
  );
}
