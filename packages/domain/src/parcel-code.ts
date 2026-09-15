/**
 * Pulling a parcel code out of whatever a scanner, camera or paste
 * produced.
 *
 * Lives here rather than in the one screen that first needed it
 * (admin's topbar scanner) because every surface that reads a code
 * faces the identical problem and must reach the identical answer: the
 * admin scan box, the public track form, and the mobile scanner all
 * accept a code typed by a person, a bare code from a handheld gun
 * reading the Code128 barcode, and a full tracking URL from a phone
 * camera reading the QR. Three implementations of "strip the origin,
 * upcase it" is three chances to disagree about what PKG-abc12x means.
 */

/**
 * Normalises scanned/typed/pasted input to a bare, upper-case code.
 *
 * Three shapes arrive and all three are legitimate:
 *  - a bare code, from a scanner gun or someone reading the label;
 *  - a tracking URL, because a parcel label's QR encodes one so an
 *    ordinary phone camera resolves to a page rather than showing
 *    plain text — which also means forwarded SMS links and pastes out
 *    of a customer's chat land here;
 *  - either of the above with stray whitespace or mixed case.
 *
 * Taking the last non-empty path segment covers every tracking-link
 * shape we emit (`/t/PKG-…` today) without keeping a list of routes in
 * sync here. A string that merely looks URL-ish but won't parse falls
 * through and is treated as a code, on the grounds that returning
 * nothing helps nobody — let the lookup be the thing that decides a
 * code isn't real.
 */
export function extractParcelCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const segments = new URL(trimmed).pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      // A bare origin ("https://esoqo.co.ke/") has no segments and no
      // code in it — returning the empty string is the honest answer,
      // not the whole URL upcased.
      if (last) return decodeURIComponent(last).trim().toUpperCase();
      return '';
    } catch {
      // Not parseable after all — fall through to the bare-code path.
    }
  }
  return trimmed.toUpperCase();
}
