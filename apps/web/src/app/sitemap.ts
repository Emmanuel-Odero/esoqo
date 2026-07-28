import type { MetadataRoute } from 'next';
const BASE = process.env.NEXT_PUBLIC_WEB_URL ?? 'https://esoko.co.ke';
export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/prices', '/counties', '/institutions', '/verify', '/help', '/trust'].map((p) => ({
    url: `${BASE}${p}`,
    changeFrequency: p === '/prices' ? 'daily' : 'weekly',
    priority: p === '' ? 1 : 0.7,
  }));
}
