import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMallBySlug } from '@esoqo/db';
import { getCtx } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ mallSlug: string }> }): Promise<Metadata> {
  const { mallSlug } = await params;
  const ctx = await getCtx();
  const mall = await getMallBySlug(ctx, mallSlug);
  return { title: mall ? (mall.knownAs || mall.officialName) : 'Mall not found' };
}

/** A lightweight tenant directory — every active MallTenancy resolved
 *  down to its tenant's live store. Not a full Jamii page (no "about
 *  us" content yet); just enough for a shopper to find who's in the
 *  mall and click through to buy from them. */
export default async function MallPage({ params }: { params: Promise<{ mallSlug: string }> }) {
  const { mallSlug } = await params;
  const ctx = await getCtx();
  const mall = await getMallBySlug(ctx, mallSlug);
  if (!mall) notFound();

  const name = mall.knownAs || mall.officialName;

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px' }}>{name}</h1>
        <p style={{ color: 'var(--tx-2)', margin: 0 }}>
          {mall.party.county ? `${mall.party.county} · ` : ''}
          {mall.tenants.length} {mall.tenants.length === 1 ? 'shop' : 'shops'}
        </p>
      </header>

      {mall.tenants.length === 0 ? (
        <p style={{ color: 'var(--tx-2)' }}>No shops are open here yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {mall.tenants.map((t) => (
            <li key={t.store!.id}>
              <Link
                href={`/s/${t.store!.slug}`}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 16px', border: '1px solid var(--line)', borderRadius: 10,
                  textDecoration: 'none', color: 'inherit',
                }}
              >
                <span>
                  <strong style={{ display: 'block' }}>{t.store!.name}</strong>
                  {t.store!.tagline && (
                    <span style={{ color: 'var(--tx-2)', fontSize: '.88rem' }}>{t.store!.tagline}</span>
                  )}
                </span>
                {t.unitLabel && <span style={{ color: 'var(--tx-3)', fontSize: '.82rem' }}>{t.unitLabel}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
