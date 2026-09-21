'use client';

import { useEffect, useState } from 'react';
import { LABEL_WIDTH_MM } from './ParcelLabel';

/**
 * A passenger luggage tag, and the stub the passenger keeps.
 *
 * This prints almost the opposite way round from a parcel label, and
 * the difference is deliberate rather than accidental.
 *
 * A parcel label is code-only (see ParcelLabel's header): its handlers
 * carry scanners, and the box carries a stranger's details, so putting
 * names on adhesive would be an exposure with no operational payoff. A
 * luggage tag's handler is a conductor with forty bags and three
 * minutes, working by torchlight at a stage, and the "stranger" is the
 * passenger standing in front of him. So the tag leads with what a
 * human reads at arm's length and keeps the scan as the verifiable
 * path rather than the only one.
 *
 * Three rules follow, and each is load-bearing:
 *
 *   1. The destination is the largest thing on the tag. It is the
 *      routing decision made a hundred times a trip.
 *   2. The passenger is surname-and-initial only (ShortenPassengerName,
 *      applied identically in core-go so the printed tag and the public
 *      scan can never disagree). Enough to call over a crowd; not
 *      enough to identify someone from a photograph of a bag.
 *   3. There is a tear-off stub. The claim check is physical first and
 *      digital second, which is what lets it work with a dead phone —
 *      the failure mode a system that only scans does not survive.
 */

// Millimetres throughout, for the reason ParcelLabel's own comment
// gives at length: screen pixels do not map predictably onto a printed
// page, and this is an artefact whose size has to be right the first
// time because it is going onto adhesive.
//
// The tag reuses the parcel label's 90mm width so both come off the
// same pad stock and the same A4 2-across grid. Height is split: 38mm
// of tag, a 4mm tear line, 14mm of stub — 56mm total, which at 5-down
// needs the taller of the two sheet layouts, so tags print 4-down.
export const LUGGAGE_TAG_WIDTH_MM = LABEL_WIDTH_MM;
export const LUGGAGE_TAG_BODY_MM = 38;
export const LUGGAGE_STUB_MM = 14;
export const LUGGAGE_TEAR_MM = 4;
export const LUGGAGE_TAG_HEIGHT_MM =
  LUGGAGE_TAG_BODY_MM + LUGGAGE_TEAR_MM + LUGGAGE_STUB_MM;

// Rasterised well above the printed size so a 300dpi engine's upscale
// stays crisp — same reasoning and the same offscreen-canvas-to-<img>
// technique ParcelLabel documents, for the same print bugs.
const QR_PIXELS = 300; // → displayed at 19mm

function useQr(text: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const canvas = document.createElement('canvas');
    void import('qrcode')
      .then((QRCode) => QRCode.toCanvas(canvas, text, { width: QR_PIXELS, margin: 1 }))
      .then(() => { if (!cancelled) setSrc(canvas.toDataURL('image/png')); });
    return () => { cancelled = true; };
  }, [text]);
  return src;
}

/**
 * Surname plus leading initial — "Mary Wanjiku" → "WANJIKU M.".
 *
 * Deliberately a duplicate of core-go's ShortenPassengerName
 * (internal/dbx/luggage.go) rather than a fetch: this runs at print
 * time on a tag that may be produced offline, and a name that arrived
 * as prose must still be reduced before it reaches the paper. The Go
 * test and this file's test pin the same cases on both sides, which is
 * the cheapest way to keep two implementations of one rule honest when
 * the direction they would drift is "print more".
 */
export function shortenPassengerName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return '';
  if (parts.length === 1) return first.toUpperCase();
  return `${last.toUpperCase()} ${first.charAt(0).toUpperCase()}.`;
}

export interface LuggageTagData {
  code: string;
  passengerName: string;
  destinationLabel: string;
  pieceNo: number;
  pieceCount: number;
}

/**
 * The tag as it prints, stub included.
 *
 * `trackingUrl` is what the QR encodes. Like a parcel label's, it is a
 * URL rather than the bare code so an ordinary phone camera — which is
 * what a worried passenger is holding — lands somewhere useful instead
 * of showing plain text. Omitted falls back to the bare code, which
 * still scans with our own scanner.
 */
export function PrintableLuggageTag({
  tag, trackingUrl, orgName,
}: {
  tag: LuggageTagData;
  trackingUrl?: string;
  orgName?: string;
}) {
  const qrSrc = useQr(trackingUrl ?? tag.code);
  const piece = `${tag.pieceNo} of ${tag.pieceCount}`;
  // Only worth showing when there is more than one — "1 of 1" on every
  // single bag trains people to stop reading the field, which is
  // exactly the field that has to be read on the bags where it matters.
  const showPiece = tag.pieceCount > 1;
  const who = shortenPassengerName(tag.passengerName);

  return (
    <div
      className="print-label luggage-tag"
      style={{
        width: `${LUGGAGE_TAG_WIDTH_MM}mm`,
        height: `${LUGGAGE_TAG_HEIGHT_MM}mm`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        border: '1px dashed #999',
        borderRadius: '2mm',
      }}
    >
      {/* ── The tag: what stays on the bag ─────────────────────── */}
      <div style={{
        height: `${LUGGAGE_TAG_BODY_MM}mm`, padding: '2.5mm 3mm',
        boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '1mm',
      }}>
        {/* Destination and piece count on one line, both large. These
            are the only two facts a conductor needs to decide whether
            this bag comes off here and whether it is travelling alone. */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '2mm' }}>
          <strong style={{
            fontSize: '8mm', lineHeight: 1, letterSpacing: '.01em', fontWeight: 800,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {tag.destinationLabel.toUpperCase()}
          </strong>
          {showPiece && (
            <span style={{ fontSize: '5mm', fontWeight: 800, lineHeight: 1, whiteSpace: 'nowrap' }}>
              {piece}
            </span>
          )}
        </div>

        <div style={{ borderTop: '0.4mm solid #111', marginTop: '0.5mm' }} />

        <div style={{ display: 'flex', gap: '3mm', alignItems: 'center', flex: 1, minHeight: 0 }}>
          <div style={{ width: '19mm', height: '19mm', flexShrink: 0 }}>
            {qrSrc && (
              <img src={qrSrc} alt={`Scan code for bag ${tag.code}`}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm', minWidth: 0, flex: 1 }}>
            {/* The code, human-readable: it gets read aloud down a phone
                line and typed into a counter more than it gets scanned. */}
            <strong className="mono" style={{ fontSize: '5mm', lineHeight: 1, letterSpacing: '.02em' }}>
              {tag.code}
            </strong>
            {/* Surname and initial only — see rule 2 in the header. */}
            <span style={{
              fontSize: '4mm', fontWeight: 700, lineHeight: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {who}
            </span>
            {orgName && (
              <span style={{ fontSize: '2.6mm', color: '#555', lineHeight: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {orgName}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── The tear line ──────────────────────────────────────── */}
      <div style={{
        height: `${LUGGAGE_TEAR_MM}mm`, borderTop: '0.4mm dashed #111',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '2.2mm', color: '#777', letterSpacing: '.2em',
      }}>
        ✂ TEAR — GIVE TO PASSENGER
      </div>

      {/* ── The stub: what the passenger keeps ─────────────────────
          Code and piece count, nothing else. No name (the passenger
          knows it), no destination (they are going there), and above
          all nothing that would matter if this fell out of a pocket.
          It is a claim check, not a record. */}
      <div style={{
        height: `${LUGGAGE_STUB_MM}mm`, padding: '1.5mm 3mm', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2mm',
      }}>
        <strong className="mono" style={{ fontSize: '5.5mm', lineHeight: 1, letterSpacing: '.02em' }}>
          {tag.code}
        </strong>
        <span style={{ fontSize: '4mm', fontWeight: 800, lineHeight: 1, whiteSpace: 'nowrap' }}>
          {showPiece ? piece : 'KEEP THIS'}
        </span>
      </div>
    </div>
  );
}
