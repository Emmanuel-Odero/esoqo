/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@esoqo/ui', '@esoqo/a11y', '@esoqo/domain'],
  typedRoutes: true,

  // Dev memory guard. Turbopack's native arena and its dev filesystem
  // cache are what push a dev server's RSS well past its V8 heap cap —
  // on a 16GB host, four of them don't fit in the Docker VM. Disabling
  // the dev cache removes the LSM compaction churn, and turbopackMemoryLimit
  // bounds Turbopack's own native side. The V8 half is
  // docker-compose.yml's NODE_OPTIONS on the esoqo-dev service.
  experimental: {
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
  async redirects() {
    return [
      /**
       * The public parcel tools moved under /parcels. Old SMS messages,
       * printed links and the staff-invite URLs still point at
       * /send-parcel, so these are permanent redirects rather than
       * removals. Query strings (e.g. ?orgSlug=&name= on a staff
       * invite) are preserved.
       */
      { source: '/send-parcel', destination: '/parcels/send', permanent: true },
      { source: '/send-parcel/track', destination: '/parcels/track', permanent: true },
      { source: '/send-parcel/:path*', destination: '/parcels/:path*', permanent: true },
    ];
  },

  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
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
