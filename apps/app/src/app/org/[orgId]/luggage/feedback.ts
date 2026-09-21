/**
 * Physical feedback for a scan: a full-screen colour flash and a
 * distinct tone.
 *
 * A conductor holding a bag in a moving vehicle at night does not read
 * prose, and the error text this replaces was the only signal that a
 * scan had failed. Green-and-one-beep versus red-and-two-buzzes is
 * legible in peripheral vision, through a jacket pocket, and to someone
 * who is looking at the passenger rather than the phone.
 *
 * Both degrade to nothing rather than throwing. Audio in particular is
 * blocked until a page has been interacted with in most browsers, and a
 * silent beep must never take the scan down with it — the visual flash
 * and the live-region announcement (see useAnnounce in LuggageDesk) are
 * the accessible path regardless.
 */

export type Verdict = 'good' | 'bad';

/** Reused across flashes — constructing an AudioContext per scan leaks
 *  them, and forty scans in three minutes is exactly the load that
 *  makes that matter. Created lazily on first use so no context is
 *  opened on a page nobody scans on. */
let audio: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio ??= new Ctor();
    return audio;
  } catch {
    return null;
  }
}

/** One short high tone for good, two lower buzzes for bad. Different in
 *  pitch AND count, so the two are distinguishable through a pocket and
 *  by someone who cannot hear the difference between two pitches. */
export function beep(verdict: Verdict): void {
  const ctx = context();
  if (!ctx) return;
  try {
    // A suspended context (never interacted with, or backgrounded) will
    // resume silently if it can; if it cannot, the catch swallows it.
    if (ctx.state === 'suspended') void ctx.resume();
    const pattern = verdict === 'good' ? [{ at: 0, hz: 1050, ms: 90 }] : [
      { at: 0, hz: 320, ms: 140 },
      { at: 0.19, hz: 320, ms: 140 },
    ];
    for (const { at, hz, ms } of pattern) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      osc.type = 'square';
      // A short ramp instead of a hard stop: an abrupt square-wave cut
      // clicks, and a click forty times a minute is what makes crews
      // turn the sound off.
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + ms / 1000 + 0.02);
    }
  } catch {
    // No sound is a degraded experience, never a failed scan.
  }
}

const FLASH_MS = 320;
const FLASH_ID = 'luggage-scan-flash';

/**
 * A brief full-viewport colour wash.
 *
 * Deliberately a bare DOM node rather than React state: it must be able
 * to fire during a pending transition, it must never re-render the
 * manifest underneath it, and it has no business in the component tree
 * that owns the scan.
 *
 * aria-hidden because the same verdict already goes to a live region as
 * words — a screen-reader user gets the message, not a description of a
 * colour.
 */
export function flash(verdict: Verdict): void {
  if (typeof document === 'undefined') return;
  // Respect a reduced-motion preference: the tone and the announcement
  // still carry the verdict, so this is the one channel that can be
  // dropped without losing the message.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  let el = document.getElementById(FLASH_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = FLASH_ID;
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '9999',
      opacity: '0', transition: `opacity ${FLASH_MS}ms ease-out`,
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }
  el.style.background = verdict === 'good'
    ? 'rgba(22, 160, 94, 0.45)'
    : 'rgba(200, 32, 32, 0.45)';
  el.style.transition = 'none';
  el.style.opacity = '1';
  // Force a reflow so the transition re-arms on a rapid second scan —
  // without it, two failures in a row show only one flash.
  void el.offsetWidth;
  el.style.transition = `opacity ${FLASH_MS}ms ease-out`;
  el.style.opacity = '0';
}
