export function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
  className = '',
  label = 'Loading…',
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`skel ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
        display: 'inline-block',
      }}
    />
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skel-card" aria-hidden="true">
      <Skeleton width="40%" height={16} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} height={12} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="tbl" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="tr" style={{ gridTemplateColumns: `repeat(${cols},1fr)` }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}
