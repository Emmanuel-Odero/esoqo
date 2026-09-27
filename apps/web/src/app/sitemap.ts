import type { MetadataRoute } from 'next';
const BASE = process.env.NEXT_PUBLIC_WEB_URL ?? 'https://esoqo.co.ke';
export default function sitemap(): MetadataRoute.Sitemap {
  // /pay/<ESK-ID> and /pay/parking/<code> are deliberately absent. The
  // first is a short link to one business and the second is a bearer
  // token for one car's bill — both work when followed, neither belongs
  // in a search index. They are noindex in their own metadata as well,
  // but a sitemap is an invitation, and this is not one.
  return [
    '', '/discover', '/prices', '/counties', '/institutions', '/verify', '/help', '/trust',
    '/parcels', '/parcels/send', '/parcels/track', '/parcels/points', '/parcels/help',
    '/pay', '/pay/business', '/pay/group', '/pay/transport', '/pay/parking', '/pay/help',
  ].map((p) => ({
    url: `${BASE}${p}`,
    changeFrequency: p === '/prices' || p === '/discover' ? 'daily' as const : 'weekly' as const,
    priority: p === '' ? 1 : 0.7,
  }));
}
