/**
 * Abstract, on-brand "no photo yet" patterns for a JamiiPage's media
 * slots (hero cover, gallery tiles, post covers). Deliberately
 * geometric/abstract rather than literal stock-illustration clip-art
 * (hands, people, doves) — those read as generic and date badly;
 * these read as intentional design regardless of the org's cause.
 *
 * Every pattern uses `currentColor` for its linework so it always
 * matches the org's own --wl-accent (set by the CSS custom property on
 * the ancestor wrapper) without per-org configuration — the *pattern*
 * is what staff curate (via JamiiMediaAsset/the admin media-library
 * screen), the *colour* always follows the org automatically.
 *
 * This registry is the trusted, code-authored source of truth —
 * JamiiMediaAsset.patternKey is a key into it, never raw SVG markup,
 * so there is no stored-XSS surface even though that table is
 * staff-editable. See that model's schema comment.
 */
import type { SVGProps } from 'react';

export type PatternKey = 'waves' | 'dots-grid' | 'concentric' | 'blob-soft' | 'chevrons' | 'radial-lines';

type PatternProps = SVGProps<SVGSVGElement>;

function Waves(props: PatternProps) {
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" fill="none" {...props}>
      {[40, 90, 140, 190, 240, 290, 340].map((y, i) => (
        <path key={y} d={`M-20 ${y} Q 80 ${y - 34} 200 ${y} T 420 ${y}`} stroke="currentColor" strokeWidth="1.4" opacity={0.16 + (i % 3) * 0.06} />
      ))}
    </svg>
  );
}

function DotsGrid(props: PatternProps) {
  const dots = [];
  for (let x = 20; x <= 380; x += 28) {
    for (let y = 20; y <= 280; y += 28) {
      dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" fill="currentColor" opacity="0.22" />);
    }
  }
  return <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" {...props}>{dots}</svg>;
}

function Concentric(props: PatternProps) {
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" fill="none" {...props}>
      {[30, 65, 100, 135, 170, 205, 240].map((r, i) => (
        <circle key={r} cx="310" cy="60" r={r} stroke="currentColor" strokeWidth="1.4" opacity={0.28 - i * 0.03} />
      ))}
    </svg>
  );
}

function BlobSoft(props: PatternProps) {
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" fill="none" {...props}>
      <path
        d="M60 210 Q10 150 55 90 Q100 30 175 45 Q260 60 285 120 Q315 190 250 230 Q170 280 60 210Z"
        stroke="currentColor" strokeWidth="1.6" opacity="0.3"
      />
      <path
        d="M120 250 Q70 210 100 160 Q135 105 200 115 Q270 125 290 175 Q310 225 255 255 Q195 290 120 250Z"
        stroke="currentColor" strokeWidth="1.2" opacity="0.18"
      />
    </svg>
  );
}

function Chevrons(props: PatternProps) {
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" fill="none" {...props}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={`M-20 ${40 + i * 44} L 200 ${10 + i * 44} L 420 ${40 + i * 44}`} stroke="currentColor" strokeWidth="1.4" opacity={0.28 - i * 0.03} />
      ))}
    </svg>
  );
}

function RadialLines(props: PatternProps) {
  const lines = [];
  for (let a = 0; a < 360; a += 12) {
    const rad = (a * Math.PI) / 180;
    const x2 = 20 + Math.cos(rad) * 340;
    const y2 = 20 + Math.sin(rad) * 340;
    lines.push(<line key={a} x1="20" y1="20" x2={x2} y2={y2} stroke="currentColor" strokeWidth="1" opacity="0.14" />);
  }
  return <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" {...props}>{lines}</svg>;
}

export const PATTERNS: Record<PatternKey, (props: PatternProps) => React.JSX.Element> = {
  waves: Waves,
  'dots-grid': DotsGrid,
  concentric: Concentric,
  'blob-soft': BlobSoft,
  chevrons: Chevrons,
  'radial-lines': RadialLines,
};

export function isPatternKey(key: string): key is PatternKey {
  return key in PATTERNS;
}

/** Renders a full-bleed placeholder: the pattern over a faint tinted
 *  background, in the current --wl-accent. Used wherever a page has no
 *  real photo yet for that slot. */
export function MediaPlaceholder({ patternKey, className }: { patternKey: string; className?: string }) {
  const Pattern = isPatternKey(patternKey) ? PATTERNS[patternKey] : PATTERNS.waves;
  return (
    <div className={`wl-placeholder${className ? ` ${className}` : ''}`}>
      <Pattern className="wl-placeholder-svg" />
    </div>
  );
}
