type NoticeVariant = 'info' | 'warning' | 'error' | 'amber';

export function Notice({
  variant = 'info',
  title,
  children,
  className = '',
}: {
  variant?: NoticeVariant;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const c = variant === 'info' ? 'n-blue' : variant === 'warning' ? 'n-amber' : variant === 'error' ? 'n-red' : 'n-amber';
  return (
    <div className={`note ${c} ${className}`} role="alert">
      <div>
        {title && <strong style={{ display: 'block', marginBottom: 4 }}>{title}</strong>}
        {typeof children === 'string' ? <p>{children}</p> : children}
      </div>
    </div>
  );
}
