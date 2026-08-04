import Link from 'next/link';
import { Icon } from '@esoko/ui';

export default function Home() {
  return (
    <div className="wrap" style={{ paddingTop: 60, paddingBottom: 60 }}>
      <span className="pill live" style={{ marginBottom: 16 }}>
        <Icon name="shop" size={12} />Esoko Store
      </span>
      <h1 style={{ fontSize: '2rem', marginBottom: 10 }}>Sell online, in person, and get paid your usual way.</h1>
      <p style={{ color: 'var(--tx-2)', fontSize: '1rem', marginBottom: 28, maxWidth: '48ch' }}>
        Open a store on your Esoko account, list what you sell, and take payment by
        M-Pesa — online through your storefront, or in person on the PoS terminal.
      </p>
      <div className="row">
        <Link href="/dashboard/new" className="btn btn-p">
          <Icon name="plus" size={16} />Open your store
        </Link>
        <Link href="/dashboard" className="btn btn-o">
          Go to your dashboard
        </Link>
      </div>
    </div>
  );
}
