import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { safeRedirect } from './safe-redirect';

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.esoqo.co.ke';
  process.env.NEXT_PUBLIC_WEB_URL = 'https://esoqo.co.ke';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_WEB_URL;
});

describe('safeRedirect', () => {
  it('allows ordinary in-app paths', () => {
    expect(safeRedirect('/me/tickets')).toBe('/me/tickets');
  });

  it('allows the cross-origin handoff this feature exists for', () => {
    expect(safeRedirect('https://esoqo.co.ke/tickets/abc')).toBe('https://esoqo.co.ke/tickets/abc');
  });

  // The finding: any https:// URL was navigated to after a real PIN entry.
  it('refuses an unknown origin', () => {
    expect(safeRedirect('https://evil.example/login')).toBe('/');
  });

  it('refuses a lookalike host', () => {
    expect(safeRedirect('https://app.esoqo.co.ke.evil.example/')).toBe('/');
  });

  it('refuses protocol-relative URLs that read as absolute to the browser', () => {
    expect(safeRedirect('//evil.example/login')).toBe('/');
  });

  it('refuses backslash variants', () => {
    expect(safeRedirect('/\\evil.example')).toBe('/');
    expect(safeRedirect('\\\\evil.example')).toBe('/');
  });

  it('refuses javascript: and data: targets', () => {
    expect(safeRedirect('javascript:alert(1)')).toBe('/');
    expect(safeRedirect('data:text/html,<script>alert(1)</script>')).toBe('/');
  });

  it('refuses embedded control characters', () => {
    expect(safeRedirect('/ok\nLocation: https://evil.example')).toBe('/');
  });

  it('falls back when absent or empty', () => {
    expect(safeRedirect(null)).toBe('/');
    expect(safeRedirect('   ')).toBe('/');
    expect(safeRedirect(undefined, undefined, '/me')).toBe('/me');
  });

  it('allows the caller’s own origin when supplied', () => {
    expect(safeRedirect('https://store.esoqo.co.ke/x', 'https://store.esoqo.co.ke')).toBe(
      'https://store.esoqo.co.ke/x',
    );
  });
});
