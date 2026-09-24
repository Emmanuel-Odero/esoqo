import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Container builds. `standalone` emits .next/standalone with only the
   * traced runtime dependencies, so the deploy image carries neither the
   * pnpm store nor the monorepo source — roughly 200MB instead of 2GB.
   *
   * outputFileTracingRoot must be the workspace root: pnpm hoists
   * @esoqo/* and their deps to the root node_modules, and without this
   * Next traces from the app directory and silently omits them.
   */
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ['@esoqo/ui', '@esoqo/a11y', '@esoqo/domain'],
  typedRoutes: true,

  // Documents up to 10MB (packages/db/src/storage.ts MAX_BYTES) are posted
  // through Server Actions, not an API route. Next's default 1MB action
  // body limit rejects them before actionUpload's try/catch ever runs,
  // crashing the whole page instead of returning a handled error.
  experimental: {
    serverActions: { bodySizeLimit: '11mb' },
    // Dev memory guard — see apps/web/next.config.mjs.
    turbopackFileSystemCacheForDev: false,
    turbopackMemoryLimit: 1024 * 1024 * 1024,
  },

  /**
   * Security headers are set HERE and again at the CDN.
   *
   * Deliberately not only in proxy.ts: a proxy bypass — of which there
   * have been two classes in sixteen months — would strip them. Defence
   * that depends on one layer is not defence. See ADR-0003.
   */
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // `camera=()` forbids camera use on the page itself (not just
        // iframes), which blocks CameraScanner's getUserMedia call
        // before the browser ever shows a permission prompt. See
        // apps/web/next.config.mjs for the same fix.
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      ],
    }];
  },

  /**
   * The self-serve /join registration flow is disabled for now — the app
   * is sign-in only. The route itself has been removed from the app
   * router, and this forwards any surviving link (an SMS, a bookmark,
   * the marketing site) to /signin rather than a 404. Delete this entry
   * and restore the join route to bring registration back.
   *
   * Backward-compatibility redirects for the legacy portal routes:
   *
   * /parcel-org/*         → /org/courier/<id>/*
   *   The old courier portal lived at /parcel-org. The org ID is stored
   *   in the esoqo_parcel_org_session cookie, which we can't read in a
   *   Next.js redirect rule (they're static). So these redirects point to
   *   a middleware-handled catch-all that reads the cookie and redirects to
   *   the right org ID.  The middleware file is at src/middleware.ts.
   *
   * /org/[orgId]/*        → /org/ticket/<orgId>/*
   *   The old ticketing portal used /org/[orgId] with no type segment.
   *   We preserve those URLs by treating a bare UUID segment as a ticket org.
   */
  async redirects() {
    return [
      { source: '/join', destination: '/signin', permanent: false },

      // Legacy parcel-org portal routes: handled by middleware (needs cookie)
      // These fallback redirects fire only if middleware hasn't already redirected.
      {
        source: '/parcel-org',
        destination: '/parcel-org-bridge',
        permanent: false,
        missing: [{ type: 'cookie', key: 'esoqo_parcel_org_session' }],
      },

      // Legacy org/[orgId] (ticket) routes — redirect to the new typed URL.
      // We use a regex that matches a bare UUID segment so /org/courier/x
      // and /org/hotel/x aren't caught here.
      {
        source: '/org/:orgId((?!courier|ticket|hotel|eatery|chama|tout)[^/]+)',
        destination: '/org/ticket/:orgId',
        permanent: false,
      },
      {
        source: '/org/:orgId((?!courier|ticket|hotel|eatery|chama|tout)[^/]+)/:rest*',
        destination: '/org/ticket/:orgId/:rest*',
        permanent: false,
      },
    ];
  },
};
export default nextConfig;
