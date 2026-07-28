import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'white' | 'danger';
type Size = 'sm' | 'md';

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
  children?: React.ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = variant === 'primary' ? 'btn-p' : variant === 'outline' ? 'btn-o' : variant === 'white' ? 'btn-w' : 'btn-d';
  const s = size === 'sm' ? ' btn-sm' : '';
  return (
    <button className={`btn ${v}${s} ${className}`} {...rest}>
      {children}
    </button>
  );
}
