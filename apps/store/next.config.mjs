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
  transpilePackages: ['@esoqo/ui', '@esoqo/a11y', '@esoqo/domain', '@esoqo/payments'],
  typedRoutes: true,

  // Dev memory guard — see apps/web/next.config.mjs.
  experimental: {
    turbopackFileSystemCacheForDev: false,
    turbopackMemoryLimit: 1024 * 1024 * 1024,
  },

  /**
   * Security headers are set HERE and again at the CDN — see apps/app's
   * next.config.mjs and ADR-0003 for why proxy.ts is not enough on its own.
   */
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      ],
    }];
  },
};
export default nextConfig;
