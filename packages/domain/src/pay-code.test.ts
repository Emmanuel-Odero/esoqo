import { describe, it, expect } from 'vitest';
import {
  extractEsoqoId, isEsoqoIdShape, buildPayLink, buildShortPayLink, mintEsoqoCode,
  ESK_CODE_ALPHABET, ESK_CODE_LENGTH,
} from './pay-code';

// The current minted shape (six characters from the unambiguous
// alphabet) and the legacy four-digit one, which is deliberately still
// resolvable — see pay-code.ts and core-go's dbx/payment_id.go.
const CURRENT = 'ESK-BCUP2K-KE';
const LEGACY = 'ESK-4471-KE';

describe('isEsoqoIdShape', () => {
  it('accepts the current six-character shape', () => {
    expect(isEsoqoIdShape(CURRENT)).toBe(true);
    expect(isEsoqoIdShape('esk-bcup2k-ke')).toBe(true);
  });

  it('still accepts the legacy four-digit shape', () => {
    expect(isEsoqoIdShape(LEGACY)).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isEsoqoIdShape(`  ${CURRENT} `)).toBe(true);
  });

  it('rejects a wrong-length segment', () => {
    expect(isEsoqoIdShape('ESK-4471')).toBe(false);
    expect(isEsoqoIdShape('ESK-1234567-KE')).toBe(false);
  });

  // The alphabet exists so a code read aloud off a printed stand cannot
  // be mistyped into a different valid-looking string. Accepting the
  // excluded characters would undo the point of it.
  it('rejects characters outside the unambiguous alphabet', () => {
    expect(isEsoqoIdShape('ESK-IL0UVW-KE')).toBe(false);
    expect(isEsoqoIdShape('ESK-ABC001-KE')).toBe(false);
  });

  it('rejects a wrong suffix', () => {
    expect(isEsoqoIdShape('ESK-BCUP2K-XX')).toBe(false);
  });

  it('rejects things that are not IDs at all', () => {
    expect(isEsoqoIdShape('Mama Mboga Kitchen')).toBe(false);
    expect(isEsoqoIdShape('0712345678')).toBe(false);
    // The fabricated ESOQO-<uuid> shape the first /pay prototype used
    // must never be mistaken for an issued ID.
    expect(isEsoqoIdShape('ESOQO-1A2B3C4D')).toBe(false);
  });
});

describe('extractEsoqoId', () => {
  it('passes a bare code through, upper-cased', () => {
    expect(extractEsoqoId(CURRENT)).toBe(CURRENT);
    expect(extractEsoqoId('esk-bcup2k-ke')).toBe(CURRENT);
    expect(extractEsoqoId(LEGACY)).toBe(LEGACY);
    expect(extractEsoqoId('esk-4471-ke')).toBe(LEGACY);
  });

  // A handheld scanner gun often appends a carriage return as its
  // "Enter", and a paste out of a chat app drags whitespace with it.
  it('trims whitespace a gun or a paste drags along', () => {
    expect(extractEsoqoId(`  ${CURRENT}\r\n`)).toBe(CURRENT);
  });

  it('pulls the ID out of a pay link', () => {
    expect(extractEsoqoId(`https://esoqo.co.ke/pay?to=${CURRENT}`)).toBe(CURRENT);
    expect(extractEsoqoId('http://localhost:3000/pay?to=esk-bcup2k-ke')).toBe(CURRENT);
  });

  it('keeps the pay link amount and utm params out of the result', () => {
    expect(extractEsoqoId(`https://esoqo.co.ke/pay?to=${CURRENT}&amount=500.00&utm_source=sms`))
      .toBe(CURRENT);
  });

  it('falls back to the last path segment', () => {
    expect(extractEsoqoId(`https://esoqo.co.ke/pay/${CURRENT}`)).toBe(CURRENT);
  });

  it('returns empty for input that is not an Esoqo ID', () => {
    expect(extractEsoqoId('')).toBe('');
    expect(extractEsoqoId('   ')).toBe('');
    expect(extractEsoqoId('Mama Mboga Kitchen')).toBe('');
    expect(extractEsoqoId('0712345678')).toBe('');
    expect(extractEsoqoId('https://esoqo.co.ke/')).toBe('');
    // A pay link with no ID in it is not a payable code.
    expect(extractEsoqoId('https://esoqo.co.ke/pay?amount=500')).toBe('');
  });

  // An ordinary phone camera scanning a random QR must not be turned
  // into a lookup for a business whose name happens to look like a URL.
  it('does not throw on a URL-shaped string it cannot parse', () => {
    expect(extractEsoqoId(`http://[bad url?to=${CURRENT}`)).toBe('');
  });
});

describe('buildPayLink', () => {
  it('builds the link a printed QR encodes', () => {
    expect(buildPayLink('https://esoqo.co.ke', CURRENT))
      .toBe(`https://esoqo.co.ke/pay?to=${CURRENT}`);
  });

  it('round-trips through extractEsoqoId', () => {
    const link = buildPayLink('https://esoqo.co.ke', CURRENT, 500);
    expect(extractEsoqoId(link)).toBe(CURRENT);
  });

  it('includes a fixed amount when the business set one', () => {
    expect(buildPayLink('https://esoqo.co.ke', CURRENT, 500))
      .toBe(`https://esoqo.co.ke/pay?to=${CURRENT}&amount=500.00`);
  });

  // Zero, negative and NaN are the three ways a numeric input field
  // turns into a nonsense number, and a `?amount=NaN` on a printed
  // stand is a support call.
  it('omits a meaningless amount instead of printing it', () => {
    expect(buildPayLink('https://esoqo.co.ke', CURRENT, 0)).toBe(`https://esoqo.co.ke/pay?to=${CURRENT}`);
    expect(buildPayLink('https://esoqo.co.ke', CURRENT, -5)).toBe(`https://esoqo.co.ke/pay?to=${CURRENT}`);
    expect(buildPayLink('https://esoqo.co.ke', CURRENT, Number.NaN)).toBe(`https://esoqo.co.ke/pay?to=${CURRENT}`);
  });

  it('normalises the ID it is given', () => {
    expect(buildPayLink('https://esoqo.co.ke', ' esk-bcup2k-ke '))
      .toBe(`https://esoqo.co.ke/pay?to=${CURRENT}`);
  });

  it('refuses to build a link to something that is not a business ID', () => {
    expect(() => buildPayLink('https://esoqo.co.ke', 'Mama Mboga Kitchen')).toThrow();
  });
});

describe('buildShortPayLink', () => {
  it('puts the ID in the path, where it costs less than a query string', () => {
    expect(buildShortPayLink('https://esoqo.co.ke', CURRENT))
      .toBe(`https://esoqo.co.ke/pay/${CURRENT}`);
  });

  it('round-trips through extractEsoqoId', () => {
    expect(extractEsoqoId(buildShortPayLink('https://esoqo.co.ke', CURRENT))).toBe(CURRENT);
  });

  it('is short enough to sit in a receipt SMS with its receipt code', () => {
    const link = buildShortPayLink('https://pay.esoqo.co.ke', CURRENT);
    expect(link.length).toBeLessThanOrEqual(45);
  });

  // The reason this function exists. The long form is 45 characters on
  // this host, and once a receipt message has an amount, a business name
  // and a receipt code in it, an SMS has to drop something — and
  // clipping the link drops the Esoqo ID, which is the only part that
  // matters.
  it('is materially shorter than the query-string form', () => {
    const short = buildShortPayLink('https://pay.esoqo.co.ke', CURRENT).length;
    const long = buildPayLink('https://pay.esoqo.co.ke', CURRENT).length;
    expect(short).toBeLessThan(long);
  });

  it('normalises the ID it is given', () => {
    expect(buildShortPayLink('https://esoqo.co.ke', ' esk-bcup2k-ke '))
      .toBe(`https://esoqo.co.ke/pay/${CURRENT}`);
  });

  it('refuses to build a link to something that is not a business ID', () => {
    expect(() => buildShortPayLink('https://esoqo.co.ke', 'Mama Mboga Kitchen')).toThrow();
  });

  it('resolves against a subpath base URL without carrying it', () => {
    expect(buildShortPayLink('https://esoqo.co.ke/ke', CURRENT))
      .toBe(`https://esoqo.co.ke/pay/${CURRENT}`);
  });
});

describe('mintEsoqoCode', () => {
  // The alphabet must stay byte-for-byte identical to fleetqr.Alphabet in
  // services/core-go/internal/fleetqr/qr.go. If the two ever disagree,
  // codes minted on one side stop validating on the other, and only in
  // production.
  it('uses exactly the Go fleetqr alphabet', () => {
    expect(ESK_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    expect(ESK_CODE_ALPHABET).toHaveLength(31);
  });

  it('excludes the characters that get mistyped', () => {
    // I, L and O; and 0 and 1 — the O/0, I/1 and L/1 confusions.
    for (const ch of 'ILO01') expect(ESK_CODE_ALPHABET).not.toContain(ch);
  });

  it('mints codes the shape check accepts', () => {
    for (let i = 0; i < 500; i++) {
      const code = mintEsoqoCode();
      expect(code).toMatch(/^ESK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}-KE$/);
      expect(isEsoqoIdShape(code)).toBe(true);
      expect(extractEsoqoId(code)).toBe(code);
    }
  });

  it('never mints the legacy four-digit shape', () => {
    for (let i = 0; i < 200; i++) {
      expect(mintEsoqoCode()).not.toMatch(/^ESK-\d{4}-KE$/);
    }
  });

  // 31 does not divide 256, so a naive `%` would favour the first 17
  // characters. A large sample is a blunt but honest way to catch that.
  it('does not visibly favour the low end of the alphabet', () => {
    const counts = new Map<string, number>();
    const draws = 31 * 400;
    for (let i = 0; i < draws; i++) {
      for (const ch of mintEsoqoCode().slice(4, -3)) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    const expected = (draws * ESK_CODE_LENGTH) / ESK_CODE_ALPHABET.length;
    for (const ch of ESK_CODE_ALPHABET) {
      const got = counts.get(ch) ?? 0;
      expect(got).toBeGreaterThan(expected * 0.85);
      expect(got).toBeLessThan(expected * 1.15);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(mintEsoqoCode());
    // ~8.9e8 possible codes; 1000 draws colliding is not a real event.
    expect(seen.size).toBe(1000);
  });
});
