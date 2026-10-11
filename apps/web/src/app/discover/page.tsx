import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { anonCtx, listPublicStores } from '@esoqo/db';
import { StoreBrowser } from './StoreBrowser';

export const metadata: Metadata = {
  title: 'Discover stores',
  description: 'Shops and traders selling on Esoqo — browse by county or search for what you need.',
};
export const dynamic = 'force-dynamic';

const STORE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? 'http://localhost:3003';

export default async function DiscoverPage() {
  const stores = await listPublicStores(anonCtx());

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Discover</p>
          <h1>Shops and traders on Esoqo</h1>
          <p className="lead">
            Every store here belongs to a real, registered Esoqo business. Buy directly, pay by
            M-Pesa, and know who you&apos;re buying from.
          </p>
          <p style={{ marginTop: 14 }}>
            <Link href="/prices" style={{ color: 'var(--green)', fontWeight: 600 }}>
              Today&apos;s market prices →
            </Link>
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          {stores.length === 0 ? (
            <div className="note n-blue">
              <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
              <p>
                No stores are open yet. Traders open theirs from their Esoqo account — once they
                do, it appears here automatically.
              </p>
            </div>
          ) : (
            <StoreBrowser
              stores={stores.map((s) => ({
                slug: s.slug,
                name: s.name,
                county: s.enterprise.party.county ?? null,
                workRaw: s.enterprise.workRaw,
                productCount: s._count.products,
                posEnabled: s.posEnabled,
                primaryCategory: s.primaryCategory,
                verified: s.enterprise.isRegistered,
                handleUrl: `${STORE_URL}/@${s.slug}`,
              }))}
            />
          )}
        </div>
      </section>
    </>
  );
}
