import { describe, it, expect } from 'vitest';
import {
  extractEsoqoId, isEsoqoIdShape, buildPayLink, buildShortPayLink,
} from './pay-code';

const CURRENT = 'mutukuka482';

describe('isEsoqoIdShape', () => {
  it('accepts a handle, in any case', () => {
    expect(isEsoqoIdShape(CURRENT)).toBe(true);
    expect(isEsoqoIdShape('MUTUKUKA482')).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isEsoqoIdShape(`  ${CURRENT} `)).toBe(true);
  });

  it('rejects a wrong-length digit tail', () => {
    expect(isEsoqoIdShape('mutukuka')).toBe(false);
    expect(isEsoqoIdShape('mutukuka4821')).toBe(false);
  });

  it('rejects anything with a hyphen in it', () => {
    expect(isEsoqoIdShape('mutukuka-482')).toBe(false);
  });

  // The retired ESK- shape must not be recognised as an ID. Accepting it
  // would route a stale printed stand into a lookup that can only miss.
  it('rejects the retired ESK- code shape outright', () => {
    expect(isEsoqoIdShape('ESK-BCUP2K-KE')).toBe(false);
    expect(isEsoqoIdShape('ESK-4471-KE')).toBe(false);
    expect(isEsoqoIdShape('esk-bcup2k-ke')).toBe(false);
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
  // Handles are minted lower-case, so this folds case down rather than
  // up. The Go scanner had this backwards, which is why a handle resolved
  // in TypeScript but silently missed in core-go.
  it('passes a bare handle through, lower-cased', () => {
    expect(extractEsoqoId(CURRENT)).toBe(CURRENT);
    expect(extractEsoqoId('MUTUKUKA482')).toBe(CURRENT);
  });

  it('returns empty for the retired ESK- shape', () => {
    expect(extractEsoqoId('ESK-BCUP2K-KE')).toBe('');
    expect(extractEsoqoId('esk-4471-ke')).toBe('');
  });

  // A handheld scanner gun often appends a carriage return as its
  // "Enter", and a paste out of a chat app drags whitespace with it.
  it('trims whitespace a gun or a paste drags along', () => {
    expect(extractEsoqoId(`  ${CURRENT}\r\n`)).toBe(CURRENT);
  });

  it('pulls the ID out of a pay link', () => {
    expect(extractEsoqoId(`https://esoqo.co.ke/pay?to=${CURRENT}`)).toBe(CURRENT);
    expect(extractEsoqoId('http://localhost:3000/pay?to=MUTUKUKA482')).toBe(CURRENT);
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
    expect(buildPayLink('https://esoqo.co.ke', ' MUTUKUKA482 '))
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
    expect(buildShortPayLink('https://esoqo.co.ke', ' MUTUKUKA482 '))
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
