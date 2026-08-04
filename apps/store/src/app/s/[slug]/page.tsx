import type { Metadata } from 'next';
import { storefrontMetadata, StorefrontBySlug } from '@/lib/storefront-render';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return storefrontMetadata(slug);
}

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StorefrontBySlug slug={slug} />;
}
