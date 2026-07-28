export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`lock${inverse ? ' inv' : ''}`}>
      <svg viewBox="0 0 132 124" width="30" height="28" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round">
          <path d="M 118 62 A 40 40 0 1 0 110.8 84.9" />
          <path d="M 38 62 L 118 62" />
          <path d="M 38 62 L 8 45" />
        </g>
      </svg>
      <span className="w">soko</span>
      <span className="sr-only">Esoko home</span>
    </span>
  );
}
