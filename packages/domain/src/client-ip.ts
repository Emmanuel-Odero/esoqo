/**
 * Client IP resolution for rate limiting and audit.
 *
 * X-Forwarded-For is append-only and attacker-influenced: a client can
 * send `X-Forwarded-For: 1.2.3.4` and the proxy appends the real address
 * to the *right*, producing `1.2.3.4, <real>`. Reading entry [0] — which
 * every call site here used to do — therefore reads a value the caller
 * chose, which silently turns any per-IP rate limit into no limit at
 * all: rotate the header, get a fresh bucket every request.
 *
 * The only trustworthy entries are the rightmost ones, appended by
 * infrastructure we control. TRUSTED_PROXY_HOPS says how many that is
 * (Render's edge is a single hop, so 1 is the default in production).
 * Counting from the right means prepended junk is skipped entirely.
 *
 * In development there is usually no proxy at all, so the header is
 * absent and callers fall back to their own 'unknown'/null default.
 */

function trustedHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  // Matches Render's single edge proxy. Behind an extra CDN hop this
  // must be raised, or the CDN's address becomes every client's bucket.
  return 1;
}

/**
 * Resolve the client IP from a request's headers.
 *
 * @param get - header accessor, e.g. `(k) => headers().get(k)`
 * @returns the trusted client address, or null when none can be trusted
 */
export function clientIpFrom(get: (name: string) => string | null | undefined): string | null {
  const xff = get('x-forwarded-for');
  if (!xff) return null;

  const parts = xff
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const hops = trustedHops();
  // The rightmost entry was appended by the nearest proxy; stepping
  // (hops - 1) further left lands on the address that proxy saw as its
  // peer. Anything further left than that is caller-supplied.
  const index = parts.length - hops;
  if (index < 0) {
    // Fewer entries than expected hops: the chain is shorter than
    // configured, so nothing here is verifiably infrastructure-appended.
    return null;
  }
  return parts[index] ?? null;
}
