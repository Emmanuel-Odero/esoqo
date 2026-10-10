import { z } from 'zod';

/**
 * Custom-domain validation for Our Jamii pages — split out of jamii.ts
 * specifically so it stays reachable from the MAIN '@esoqo/domain'
 * barrel without also pulling jamii.ts's `richTextField` (and with it
 * isomorphic-dompurify/jsdom) along for the ride.
 *
 * packages/db/src/dal/jamii-domain.ts imports this, and that DAL
 * function is re-exported from '@esoqo/db's own main barrel — which
 * every app in the monorepo depends on. jsdom reaching every app's
 * server bundle just because one of them (apps/jamii) needs rich-text
 * sanitization is what crashed unrelated pages' production builds with
 * "webidl.util.markAsUncloneable is not a function" (a jsdom 30 /
 * Turbopack externals bug) — see jamii.ts's own header comment and
 * index.ts's for the full story. Everything else Our-Jamii-specific
 * stays in jamii.ts, re-exported from '@esoqo/domain/jamii' only.
 */

/**
 * Reserved so a group can't "link" a domain we already serve from —
 * esoqo.co.ke itself, ourjamii.co.ke (this app's own primary domain),
 * or a bare subdomain of either. Checked case-insensitively against the
 * normalised hostname before it ever reaches Cloudflare.
 */
export const JAMII_RESERVED_DOMAIN_SUFFIXES = ['esoqo.co.ke', 'ourjamii.co.ke'] as const;

/**
 * A group's custom domain for their Our Jamii page — see
 * @esoqo/db's requestJamiiDomain and apps/jamii's dashboard settings
 * "Domain" panel. Deliberately strict: this is the one place a member
 * of the public types a string that later becomes a live DNS/TLS
 * target, so the shape is checked here (client + server, same schema)
 * before the DAL's own re-validation.
 *
 * - No scheme, path, port or trailing dot — a bare hostname only.
 * - Rejects IP literals (v4 or v6-looking) — a domain is required, not
 *   an address.
 * - At least one label + a plausible TLD (2+ alpha chars) so obvious
 *   junk ("localhost", "mchama") is rejected before hitting the DAL's
 *   reserved-suffix / uniqueness checks.
 */
export const jamiiDomainHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((v) => !/^https?:\/\//.test(v) && !v.includes('/') && !v.includes(':'), {
    message: 'Enter just the domain, e.g. mchamawetu.org — no https:// or path',
  })
  .refine((v) => !/^\d{1,3}(\.\d{1,3}){3}$/.test(v) && !v.includes('['), {
    message: 'Enter a domain name, not an IP address',
  })
  .refine((v) => /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,}$/.test(v), {
    message: 'Enter a valid domain, e.g. mchamawetu.org',
  });
export type JamiiDomainHostnameInput = z.infer<typeof jamiiDomainHostnameSchema>;

export const requestJamiiDomainSchema = z.object({
  hostname: jamiiDomainHostnameSchema,
});
export type RequestJamiiDomainInput = z.infer<typeof requestJamiiDomainSchema>;
