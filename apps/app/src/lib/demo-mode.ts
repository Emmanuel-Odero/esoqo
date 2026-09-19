/**
 * DEMO_MODE — outbound communication is switched off.
 *
 * The demo database is full of real-looking people and phones, and the
 * quickest way to break a sales demo is to tap "Call the driver" and
 * ring an actual number. NEXT_PUBLIC_DEMO_MODE=1 turns every tel:/sms:
 * affordance on the parcel-org portal into a disabled control that says
 * why, instead of dialling out. Nothing here affects booking, custody
 * or reporting — only off-platform calls and messages.
 *
 * Read at build time like other NEXT_PUBLIC_ flags; the portal layout
 * renders a banner from the same flag so the demo never looks broken,
 * just sandboxed.
 */
export const DEMO_MODE = ['1', 'true']
  .includes(String(process.env.NEXT_PUBLIC_DEMO_MODE ?? '').trim().toLowerCase());

/** Copy shown on anything the demo has switched off. */
export const DEMO_NOTE = 'Calls and messages are switched off in this demo';

/** A number can be tapped in a real environment; in the demo it cannot. */
export function phoneHref(msisdn: string): string | null {
  if (DEMO_MODE) return null;
  const digits = msisdn.replace(/[^\d+]/g, '');
  return `tel:${digits.startsWith('+') ? digits : `+${digits}`}`;
}

/** Same contract as phoneHref for the SMS side. */
export function smsHref(msisdn: string): string | null {
  if (DEMO_MODE) return null;
  return `sms:${msisdn.replace(/[^\d+]/g, '')}`;
}