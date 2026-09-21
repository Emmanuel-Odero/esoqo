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

  // Same 10MB document uploads (group docs, walk-in registration docs) go
  // through Server Actions here too — see apps/app/next.config.mjs.
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
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      ],
    }];
  },
};
export default nextConfig;
