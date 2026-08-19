/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@esoko/ui', '@esoko/a11y', '@esoko/domain', '@esoko/payments'],
  typedRoutes: true,

  /**
   * Dev-server-only (Next ignores this in production builds) — lets
   * local custom-domain testing work against *.localtest.me without
   * the dev overlay's cross-origin guard blocking its own diagnostic
   * requests. See docs/proposals/our-jamii-custom-domains.md's
   * "Testing locally" section.
   */
  allowedDevOrigins: ['*.localtest.me'],

  /**
   * Public org galleries/covers hot-link Wikimedia Commons images in
   * seed/demo data (see the prototype this app is built from) — allowed
   * explicitly rather than opened up wide. Real uploads are served via
   * /img (same opaque-storage-key discipline as apps/store), which
   * needs no remote pattern.
   */
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'commons.wikimedia.org' },
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
    ],
  },

  /**
   * Security headers are set HERE and again at the CDN — see
   * apps/store's next.config.mjs and ADR-0003 for why proxy.ts is not
   * enough on its own.
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
