/**
 * Post-authentication redirect targets.
 *
 * A `next=` parameter that is navigated to without checking is the
 * classic post-login phishing primitive: the attacker sends a link to
 * the real Esoqo sign-in page, the user checks the domain, types a real
 * PIN, and is then handed to a lookalike that asks them to "confirm" it.
 * The credential entry was genuine, which is exactly what makes the
 * handoff convincing.
 *
 * Cross-origin cannot simply be banned — ticket booking on apps/web
 * sends buyers to apps/app to sign in and back again. So absolute URLs
 * are allowed only to origins we publish ourselves.
 */

/** Origins this deployment will hand a signed-in user to. */
function allowedOrigins(): string[] {
  const out: string[] = [];
  for (const raw of [
    process.env.NEXT_PUBLIC_WEB_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_STORE_URL,
    process.env.NEXT_PUBLIC_JAMII_URL,
    process.env.NEXT_PUBLIC_ADMIN_URL,
    process.env.NEXT_PUBLIC_CECF_URL,
  ]) {
    if (!raw) continue;
    try {
      out.push(new URL(raw).origin);
    } catch {
      // A malformed env value must not widen the allowlist.
    }
  }
  return out;
}

/**
 * Resolve a caller-supplied redirect target to something safe to
 * navigate to.
 *
 * @param next - the untrusted value (query param, form field, API result)
 * @param currentOrigin - the origin doing the navigating, if known
 * @param fallback - where to go when `next` is missing or not allowed
 * @returns a relative path, or an absolute URL on an allowed origin
 */
export function safeRedirect(
  next: string | null | undefined,
  currentOrigin?: string,
  fallback = '/',
): string {
  if (!next) return fallback;

  const value = next.trim();
  if (!value) return fallback;

  // Protocol-relative ("//evil.com") and control characters are the
  // usual ways past a naive "starts with /" check — the browser reads
  // //evil.com as an absolute URL, and a stray \ or newline can split
  // the value back apart downstream.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\') || value.startsWith('\\')) return fallback;

  // Ordinary in-app path.
  if (value.startsWith('/')) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fallback; // not a path and not a URL
  }

  // javascript:, data:, and friends never reach a navigation.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback;

  const allowed = allowedOrigins();
  if (currentOrigin) allowed.push(currentOrigin);
  if (allowed.includes(url.origin)) return url.toString();

  return fallback;
}
