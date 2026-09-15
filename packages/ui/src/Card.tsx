import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  as: Tag = 'div',
  lift = false,
  pad = 'md',
}: {
  children?: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'a';
  lift?: boolean;
  pad?: 'md' | 'lg' | 'none';
}) {
  const padCls = pad === 'lg' ? ' card-pad-lg' : pad === 'none' ? ' p-0' : '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const C = Tag as any;
  return <C className={`card${lift ? ' card-lift' : ''}${padCls} ${className}`}>{children}</C>;
}
