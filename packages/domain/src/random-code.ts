/**
 * Draws `length` characters from `alphabet` using the platform CSPRNG.
 *
 * Shared by every code family that mints a credential a stranger must not
 * be able to guess or bias — pay-code.ts's Esoqo Payment IDs and
 * parking-code.ts's lot/ticket codes both used to carry their own copy of
 * this exact rejection-sampling loop. One implementation means a fix to
 * the rejection bound, or to the CSPRNG check, applies to every code
 * family at once rather than to whichever one somebody remembered to
 * patch.
 *
 * Sampling is by rejection rather than `%`: unless `alphabet.length`
 * divides 256 evenly, a modulo makes the low end of the alphabet
 * measurably more likely than the rest, and a code that favours a
 * handful of characters is a code worth guessing.
 */
export function randomAlphabetString(alphabet: string, length: number): string {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.getRandomValues) {
    throw new Error('randomAlphabetString needs a CSPRNG (globalThis.crypto.getRandomValues)');
  }
  const out: string[] = [];
  const ceiling = 256 - (256 % alphabet.length);
  while (out.length < length) {
    const bytes = webcrypto.getRandomValues(new Uint8Array(length));
    for (const byte of bytes) {
      if (byte >= ceiling) continue;
      out.push(alphabet.charAt(byte % alphabet.length));
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** The 31-character set every human-read code in the product draws from —
 *  excludes I, L, O, 0 and 1, the characters most likely to be mistyped
 *  reading a code off a printed stand or sign. */
export const UNAMBIGUOUS_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
