import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { storefrontMetadata, StorefrontBySlug } from '@/lib/storefront-render';

export const dynamic = 'force-dynamic';

function slugFromHandle(handle: string): string | null {
  // Next does not decode a leading `%40` in a dynamic segment the way
  // it decodes the rest of the URL — decode explicitly before matching.
  const decoded = decodeURIComponent(handle);
  return decoded.startsWith('@') ? decoded.slice(1) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const slug = slugFromHandle(handle);
  return slug ? storefrontMetadata(slug) : {};
}

/** Serves the free `esoqo.com/@slug` address. Any other top-level
 *  segment that isn't a real static route (/dashboard, /signin, /pos)
 *  falls through to here too, and is correctly a 404. */
export default async function HandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const slug = slugFromHandle(handle);
  if (!slug) notFound();
  return <StorefrontBySlug slug={slug} />;
}
