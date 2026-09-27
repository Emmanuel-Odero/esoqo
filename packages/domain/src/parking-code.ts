/**
 * Codes and links for parking.
 *
 * Two short codes, deliberately kept apart:
 *
 *   · `PRK-…` names a car park. It is the thing printed on the sign at
 *     the entrance and encoded in the QR a driver scans on the way in.
 *     It changes when a lot is re-branded and almost never otherwise.
 *   · `PRT-…` is a single vehicle's ticket for one stay. It is texted
 *     to the driver at check-in and is the only thing they need at
 *     checkout.
 *
 * Both draw from the same unambiguous alphabet as every other code a
 * person reads aloud in the product — no 0/O, no 1/I/L — because a
 * parking code is dictated at an entrance, usually in the rain, usually
 * by somebody holding a phone in one hand. A fat-fingered character has
 * to fail as "not a code" rather than as a lookup that quietly misses
 * and charges somebody the wrong amount.
 *
 * Kept in domain rather than the DAL so the shapes are testable without
 * a database, and so the web page and the SMS composer cannot disagree
 * about what a code looks like.
 */

import { randomAlphabetString, UNAMBIGUOUS_ALPHABET } from './random-code';

const CODE_ALPHABET = UNAMBIGUOUS_ALPHABET;
const CODE_CHARS = 4;

export const PARKING_LOT_PREFIX = 'PRK';
export const PARKING_TICKET_PREFIX = 'PRT';

/** `PRK-4KX9-2J` and `PRT-7QW2-4X` — the lot and the ticket share a
 *  shape on purpose, so one mental model covers both, and one keyboard
 *  pattern at the entrance covers both. */
const CODE_SHAPE = new RegExp(
  `^(?:${PARKING_LOT_PREFIX}|${PARKING_TICKET_PREFIX})-[${CODE_ALPHABET}]{${CODE_CHARS}}-[${CODE_ALPHABET}]{2}$`,
);

/** Picks `n` characters from the unambiguous alphabet — crypto-strength,
 *  same as mintEsoqoCode: these codes are the only thing standing between
 *  a stranger and somebody's parked car bill, and Math.random is not
 *  that. 31^4 per half is ~923k; a collision is caught by the unique
 *  index and retried at the call site, so the space only has to be big
 *  enough not to collide in practice. */
function randomSegment(n: number): string {
  return randomAlphabetString(CODE_ALPHABET, n);
}

export function mintParkingLotCode(): string {
  return `${PARKING_LOT_PREFIX}-${randomSegment(CODE_CHARS)}-${randomSegment(2)}`;
}

export function mintParkingTicketCode(): string {
  return `${PARKING_TICKET_PREFIX}-${randomSegment(CODE_CHARS)}-${randomSegment(2)}`;
}

/** Whether `raw` is a parking code of either kind. Case and surrounding
 *  whitespace are forgiven — it is read off a sign or typed on a keypad,
 *  never pasted — but the shape is not: a lot code and a ticket code are
 *  the same shape, so this answers "is this ours", not "which is it". */
export function isParkingCodeShape(raw: string): boolean {
  return CODE_SHAPE.test(raw.trim().toUpperCase());
}

/** Normalises a scanned or typed code to its canonical upper form, or
 *  null if it is not a parking code at all. A QR that encodes a full URL
 *  is a real possibility — somebody printed the link rather than the
 *  code — so the last path segment is accepted too, exactly as
 *  extractEsoqoId does for a scanned pay link. */
export function normaliseParkingCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lastSegment = trimmed.includes('/') ? (trimmed.split('/').pop() ?? trimmed) : trimmed;
  const candidate = (lastSegment.split(/[?#&]/)[0] ?? '').trim().toUpperCase();
  return CODE_SHAPE.test(candidate) ? candidate : null;
}

/** The link a parking lot's printed QR encodes.
 *
 *  A URL and never a bare code, for the same reason the /pay QR is: a
 *  phone camera has no idea what `PRK-4KX9-2J` is and will helpfully
 *  offer to search for it. The lot is carried in the path, not a query
 *  parameter, so a printed sticker can be replaced with a parking-only
 *  domain later without reprinting the lot's code.
 */
export function buildParkingLink(baseUrl: string, lotCode: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/pay/parking/${lotCode.toUpperCase()}`;
}
