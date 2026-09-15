import { describe, it, expect, afterEach } from 'vitest';
import { clientIpFrom } from './client-ip';

const hdr = (xff?: string) => (name: string) =>
  name === 'x-forwarded-for' && xff !== undefined ? xff : null;

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe('clientIpFrom', () => {
  it('reads the proxy-appended entry, not the caller-supplied one', () => {
    // The attack this exists to stop: the client prepends whatever it
    // likes and the real address is appended to the right.
    expect(clientIpFrom(hdr('1.2.3.4, 41.90.0.7'))).toBe('41.90.0.7');
  });

  it('is stable when the caller rotates the forged prefix', () => {
    const a = clientIpFrom(hdr('9.9.9.9, 41.90.0.7'));
    const b = clientIpFrom(hdr('8.8.8.8, 41.90.0.7'));
    expect(a).toBe(b);
    expect(a).toBe('41.90.0.7');
  });

  it('handles a single honest hop', () => {
    expect(clientIpFrom(hdr('41.90.0.7'))).toBe('41.90.0.7');
  });

  it('returns null when the header is absent', () => {
    expect(clientIpFrom(hdr())).toBeNull();
  });

  it('returns null rather than a caller-supplied value when the chain is too short', () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    expect(clientIpFrom(hdr('41.90.0.7'))).toBeNull();
  });

  it('honours an extra trusted hop', () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    expect(clientIpFrom(hdr('1.2.3.4, 41.90.0.7, 10.0.0.1'))).toBe('41.90.0.7');
  });
});
