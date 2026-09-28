/**
 * Reading and writing the Esoqo business ID a payment QR carries.
 *
 * The /pay page has to answer the same question from four different
 * inputs — a bare code read off a printed stand, a pay link opened by an
 * ordinary phone camera, a code typed by hand, and a link pasted out of
 * a WhatsApp chat — and every surface that answers it has to reach the
 * *same* answer. That is the same argument packages/domain/src/parcel-code.ts
 * makes for the parcel resolver, and it is why the rules live here
 * rather than inside the one screen that happens to need them today.
 *
 * ## Why the QR carries a link, not a bare code
 *
 * A bare `ESK-4471-KE` is what core-go's scanner resolver understands
 * (see services/core-go/internal/dbx/scan.go, where the ESK- prefix maps
 * to the public `party` projection). It is the right payload for the
 * Esoqo scanner. It is the *wrong* payload for an ordinary phone camera,
 * which has no idea what to do with a payment handle and will just
 * offer to search the web for it.
 *
 * So the printed QR encodes a pay link, and a phone camera's
 * "open this URL" is what gets the payer to a page where they can enter
 * an amount and their own M-Pesa number — which is the only shape that
 * can satisfy both halves of the requirement at once. extractEsoqoId
 * below accepts either shape, so a business that prints the bare code,
 * the link, or pastes the link into a chat all resolve identically.
 */

/**
 * The issued-code shapes, and why there are two.
 *
 * Codes are minted as `ESK-` + six characters from the unambiguous
 * alphabet (no I/L/O, no 0/1) + `-KE` — see
 * services/core-go/internal/dbx/payment_id.go's generatePaymentIdCode
 * and fleetqr.Alphabet. The older `ESK-` + four digits + `-KE` shape is
 * no longer minted anywhere; per that same Go comment it is "just no
 * longer minted", and deliberately still *resolvable*, because codes
 * already in the field — printed on a stand, sent over SMS when one was
 * issued — must not stop working. Both are accepted for that reason, and
 * neither party can be asked to re-print.
 *
 * Shape only. This answers "could this be one", never "is this one" —
 * only the database knows that, and only the lookup does.
 */
import { randomAlphabetString, UNAMBIGUOUS_ALPHABET } from './random-code';
import { isSystemHandleShape } from './handle-code';

const ESK_CURRENT = `[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}`;
const ESK_LEGACY = `[0-9]{4}`;
const ESK_SHAPE = new RegExp(`^ESK-(?:${ESK_CURRENT}|${ESK_LEGACY})-KE$`);

/**
 * The characters a new code is drawn from — the same 31-character set
 * fleetqr.Alphabet defines on the Go side
 * (services/core-go/internal/fleetqr/qr.go). It is exported rather than
 * inlined into the pattern above so the TypeScript minter and the shape
 * check cannot drift apart, and it is the one place to change if the
 * alphabet is ever revisited.
 *
 * Excludes I, L and O, and 0 and 1: the characters a person is most
 * likely to mistype when reading a code off a printed stand and typing
 * it into a phone, which is what turns a six-character code into a
 * support call when a near-miss is silently "not found". O and 0, I and
 * 1, and L and 1 are the confusable pairs.
 */
export const ESK_CODE_ALPHABET = UNAMBIGUOUS_ALPHABET;

/** How many characters sit between `ESK-` and `-KE`. */
export const ESK_CODE_LENGTH = 6;

/**
 * Mints a new Esoqo Payment ID in the current shape, drawn from the
 * platform CSPRNG via randomAlphabetString (see random-code.ts) — a code
 * is a credential, not a value `Math.random` should ever produce.
 *
 * This returns a *candidate*. It has not been checked against the
 * database, and the caller owns the unique constraint and the retry —
 * minting and allocating are different jobs, and only the second one
 * can fail.
 */
export function mintEsoqoCode(): string {
  return `ESK-${randomAlphabetString(ESK_CODE_ALPHABET, ESK_CODE_LENGTH)}-KE`;
}

/** Whether a string is shaped like an Esoqo ID — either the legacy/current
 *  `ESK-XXXX-KE` payment-code shape, or the newer human-friendly handle
 *  shape from handle-code.ts (e.g. "mutukuka482"). Not a lookup — it
 *  answers "could this be one", so callers can decide whether to go
 *  looking or fall through to a name search. */
export function isEsoqoIdShape(raw: string): boolean {
  const trimmed = raw.trim();
  return ESK_SHAPE.test(trimmed.toUpperCase()) || isSystemHandleShape(trimmed);
}

/** The canonical case for a shape-matched id: ESK- codes are upper-case,
 *  handles are lower-case — the two shapes never collide (an ESK- code
 *  always contains a literal hyphen; a handle never does), so trying the
 *  ESK shape first is unambiguous. Returns '' if neither shape matches. */
function canonicalEsoqoId(raw: string): string {
  const trimmed = raw.trim();
  if (ESK_SHAPE.test(trimmed.toUpperCase())) return trimmed.toUpperCase();
  if (isSystemHandleShape(trimmed)) return trimmed.toLowerCase();
  return '';
}

/**
 * Normalises scanned, typed or pasted input to a bare, canonically-cased
 * Esoqo ID, or '' when the input isn't one.
 *
 * Three shapes arrive and all three are legitimate:
 *  - a bare code, from a scanner gun or someone reading the stand;
 *  - a pay link, because the printed QR encodes one so an ordinary
 *    phone camera resolves to a page rather than showing plain text —
 *    which also means links forwarded over chat and pasted into the
 *    lookup box land here;
 *  - either of the above with stray whitespace or mixed case (a gun
 *    often appends a carriage return as its "Enter").
 *
 * A pay link is read from its `to` query parameter first, falling back
 * to the last path segment, so `/pay?to=ESK-4471-KE` and a future
 * `/pay/mutukuka482` both work without changing this function.
 *
 * A string that merely looks URL-ish but won't parse falls through and
 * is tested as a code, on the grounds that returning nothing helps
 * nobody — let the caller be the thing that decides a code isn't real.
 */
export function extractEsoqoId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const fromQuery = (url.searchParams.get('to') ?? url.searchParams.get('party') ?? '').trim();
      const fromQueryCanonical = canonicalEsoqoId(fromQuery);
      if (fromQueryCanonical) return fromQueryCanonical;

      const segments = url.pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) {
        const decoded = decodeURIComponent(last).trim();
        const decodedCanonical = canonicalEsoqoId(decoded);
        if (decodedCanonical) return decodedCanonical;
      }
      return '';
    } catch {
      // Not parseable after all — fall through to the bare-code path.
    }
  }

  return canonicalEsoqoId(trimmed);
}

/**
 * The link a printed payment QR encodes.
 *
 * `amount` is included only when the business fixed one (a menu item
 * with a price, say). Left off otherwise, deliberately: an `amount` in
 * the URL is a *prefilled* value on a page whose amount field the payer
 * can and should still change, not an amount locked in server-side.
 */
export function buildPayLink(baseUrl: string, esoqoId: string, amountKes?: number | null): string {
  const code = extractEsoqoId(esoqoId);
  if (!code) throw new Error('buildPayLink needs a real Esoqo Payment ID');
  const url = new URL('/pay', baseUrl);
  url.searchParams.set('to', code);
  if (typeof amountKes === 'number' && Number.isFinite(amountKes) && amountKes > 0) {
    url.searchParams.set('amount', amountKes.toFixed(2));
  }
  return url.toString();
}

/**
 * The same destination, in a shape that survives an SMS.
 *
 * `/pay?to=ESK-ABC234-KE` is 45 characters on a typical host, which is
 * already more than an SMS link can carry alongside a receipt message
 * — and the obvious workaround, clipping the string to fit, produces a
 * URL with its Esoqo ID cut in half. A payer following that link lands
 * on a page for a business that does not exist, or on no business at
 * all, having been told their payment was confirmed. So the short form
 * is not a nicety: it is what makes the link safe to include at all.
 *
 * Putting the ID in the path rather than a query string is what buys
 * the space, for the same reason the parcel tracking links use their
 * own short path (`/p/<code>`) — every character in an SMS competes
 * with the message. The ID is the only thing the path carries, so the
 * length is fixed whatever the payment was for, and there is no `?to=`
 * to clip.
 */
export function buildShortPayLink(baseUrl: string, esoqoId: string): string {
  const code = extractEsoqoId(esoqoId);
  if (!code) throw new Error('buildShortPayLink needs a real Esoqo Payment ID');
  const url = new URL(`/pay/${code}`, baseUrl);
  return url.toString();
}
