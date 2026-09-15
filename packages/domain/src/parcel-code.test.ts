import { describe, it, expect } from 'vitest';
import { extractParcelCode } from './parcel-code';

describe('extractParcelCode', () => {
  it('passes a bare code through, upper-cased', () => {
    expect(extractParcelCode('PKG-ABC12X')).toBe('PKG-ABC12X');
    expect(extractParcelCode('pkg-abc12x')).toBe('PKG-ABC12X');
  });

  // A handheld scanner gun often appends a carriage return as its
  // "Enter", and a paste out of a chat app drags whitespace with it.
  it('trims whitespace a gun or a paste drags along', () => {
    expect(extractParcelCode('  PKG-ABC12X\r\n')).toBe('PKG-ABC12X');
  });

  it('pulls the code out of a tracking URL', () => {
    expect(extractParcelCode('https://esoqo.co.ke/t/PKG-ABC12X')).toBe('PKG-ABC12X');
    expect(extractParcelCode('http://localhost:3000/t/pkg-abc12x')).toBe('PKG-ABC12X');
  });

  // The route segment is not hard-coded, so a future /p/ label
  // resolver needs no change here.
  it('does not care which path the link uses', () => {
    expect(extractParcelCode('https://esoqo.co.ke/p/PKG-ABC12X')).toBe('PKG-ABC12X');
  });

  it('ignores a trailing slash and a query string', () => {
    expect(extractParcelCode('https://esoqo.co.ke/t/PKG-ABC12X/')).toBe('PKG-ABC12X');
    expect(extractParcelCode('https://esoqo.co.ke/t/PKG-ABC12X?utm_source=sms')).toBe('PKG-ABC12X');
  });

  it('decodes a percent-encoded segment', () => {
    expect(extractParcelCode('https://esoqo.co.ke/t/PKG%2DABC12X')).toBe('PKG-ABC12X');
  });

  it('returns empty for a URL with no code in it', () => {
    expect(extractParcelCode('https://esoqo.co.ke/')).toBe('');
    expect(extractParcelCode('')).toBe('');
    expect(extractParcelCode('   ')).toBe('');
  });

  // Better to hand a junk code to the lookup — which will honestly say
  // "not found" — than to swallow the input and show nothing.
  it('falls back to treating unparseable URL-ish input as a code', () => {
    expect(extractParcelCode('https://')).toBe('HTTPS://');
  });
});
