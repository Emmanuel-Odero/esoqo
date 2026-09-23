import { describe, expect, it } from 'vitest';
import { dropPointFor, trackingUrlFor } from './ParcelLabel';

/**
 * dropPointFor is the guard between a clerk's free-text "To" field and
 * the largest type on a sticker that rides in the open on a box. Both
 * of its jobs are testable and both matter: keep enough for a handler
 * with a torch to sort by, drop everything that would amount to
 * printing a receiver's address.
 */
describe('dropPointFor', () => {
  it('keeps the locality and drops the navigational detail', () => {
    expect(dropPointFor('Westlands, opposite Sarit')).toBe('WESTLANDS');
    expect(dropPointFor('Nakuru - Shell stage')).toBe('NAKURU');
    expect(dropPointFor('Kisumu / bus park')).toBe('KISUMU');
    expect(dropPointFor('Nyeri (near the market)')).toBe('NYERI');
  });

  it('passes a bare destination through, uppercased', () => {
    expect(dropPointFor('Nakuru')).toBe('NAKURU');
    expect(dropPointFor('machakos junction')).toBe('MACHAKOS JUNCTION');
  });

  it('collapses the whitespace a typed field collects', () => {
    expect(dropPointFor('  Nakuru   Town  ')).toBe('NAKURU TOWN');
  });

  it('caps a long locality so it stays legible at 5.5mm', () => {
    const out = dropPointFor('Kangundo Road Shopping Centre')!;
    expect(out.length).toBeLessThanOrEqual(18);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns undefined for anything that reduces to nothing, so the label prints its write-on rule', () => {
    expect(dropPointFor(undefined)).toBeUndefined();
    expect(dropPointFor(null)).toBeUndefined();
    expect(dropPointFor('')).toBeUndefined();
    expect(dropPointFor('   ')).toBeUndefined();
    expect(dropPointFor(', opposite Sarit')).toBeUndefined();
  });

  it('never leaks a street number or a phone number onto the sticker', () => {
    // The exposure this function exists to prevent. Whatever else
    // changes, nothing after the first separator may survive.
    for (const input of [
      'House 42, Kiambu Road, call 0722000000',
      'Nakuru, plot 17 block B',
      'Westlands, 0711222333',
    ]) {
      const out = dropPointFor(input)!;
      expect(out).not.toMatch(/\d{3}/);
      expect(out).not.toContain(',');
    }
  });
});

describe('trackingUrlFor', () => {
  // Without NEXT_PUBLIC_WEB_URL set (the case in this test env) the
  // label must fall back to the bare code rather than print a URL
  // beginning "undefined/" — it is going onto adhesive, where nobody
  // notices until it is on a box.
  it('falls back to the bare code when no web URL is configured', () => {
    expect(trackingUrlFor('PKG-ABC12X')).toBe('PKG-ABC12X');
  });
});
