import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'white' | 'danger' | 'gradient';
type Size = 'sm' | 'md' | 'lg';

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  className = '',
  disabled,
  children,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  className?: string;
  children?: React.ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const v =
    variant === 'primary' ? 'btn-p' : variant === 'outline' ? 'btn-o' : variant === 'white' ? 'btn-w' : variant === 'gradient' ? 'btn-g' : 'btn-d';
  const s = size === 'sm' ? ' btn-sm' : size === 'lg' ? ' btn-lg' : '';
  const b = block ? ' btn-block' : '';
  return (
    <button className={`btn ${v}${s}${b} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
