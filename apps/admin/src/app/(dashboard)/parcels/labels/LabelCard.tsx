'use client';

import { useEffect, useRef, useState } from 'react';
import { ScaledLabel } from '@esoqo/ui';
import type { ParcelLabelRegisterRow } from '../actions';
import { ESOQO_LOGO_URL } from './constants';

const CLIP = { overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const };

/**
 * One label, as a small visual card — its actual QR/barcode, not a row
 * of text about it. The register can hold up to 200 of these at once,
 * so each card's `ScaledLabel` (which draws a real QR and barcode onto
 * a canvas) only mounts once the card has scrolled near the viewport;
 * until then it's an inert placeholder the same size. Clicking the
 * card opens the full detail modal — the checkbox is the one part of
 * the card that doesn't, since ticking ten boxes to bulk-print
 * shouldn't open ten modals along the way.
 */
export function LabelCard({
  label, selected, onToggle, onOpen, meta,
}: {
  label: ParcelLabelRegisterRow;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** A short third line — the date something last happened to this
   *  label, or why it was withdrawn. Whatever the caller's current tab
   *  considers the one fact worth a glance. */
  meta?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="card"
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{ padding: 8, position: 'relative', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <label style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, background: '#fff', borderRadius: 4, padding: 2, lineHeight: 0 }}>
        <input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${label.code}`} />
      </label>
      {visible ? (
        <ScaledLabel
          code={label.code} sig={label.sig || undefined} route={label.routeLabel ?? undefined}
          orgName={label.orgName ?? undefined} esoqoLogoUrl={ESOQO_LOGO_URL} maxScale={1}
        />
      ) : (
        <div style={{ width: '100%', aspectRatio: '90 / 50', background: 'var(--paper)', borderRadius: 6 }} />
      )}
      <div style={{ fontSize: '.72rem' }}>
        <div style={CLIP} title={label.itemDescription ?? ''}>{label.itemDescription ?? <span className="sub">No item recorded</span>}</div>
        <div className="sub" style={CLIP} title={label.orgName ?? ''}>{label.orgName ?? 'Esoqo pool'}</div>
        {meta && <div className="sub" style={{ ...CLIP, fontSize: '.68rem' }}>{meta}</div>}
      </div>
    </div>
  );
}
