import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { getStoreBySlug, anonCtx } from '@esoko/db';
import { CashierSignInForm } from './CashierSignInForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const store = await getStoreBySlug(anonCtx(), slug);
  return { title: store ? `Cashier sign in — ${store.name}` : 'Store not found' };
}

export default async function CashierSignInPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await getStoreBySlug(anonCtx(), slug);
  if (!store) notFound();

  return (
    <div>
      <div className="page-hero">
        <div className="wrap">
          <div className="kicker"><Icon name="keypad" size={12} />PoS terminal</div>
          <h1>{store.name}</h1>
          <p className="sub">Sign in with your name and PIN to start ringing up sales.</p>
        </div>
      </div>
      <div className="wrap" style={{ paddingTop: 40, paddingBottom: 60 }}>
        <div className="auth-card">
          <div className="brand">
            <span className="brand-icon"><Icon name="shop" size={18} /></span>
            <span className="brand-text">Esoko<span>.store</span></span>
          </div>
          <div className="form-header">
            <h1>Cashier sign in</h1>
            <p>Not you? The store owner signs in <a href="/signin">here</a> instead.</p>
          </div>
          <CashierSignInForm storeSlug={slug} />
        </div>
      </div>
    </div>
  );
}
