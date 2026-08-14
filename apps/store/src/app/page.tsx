import Link from 'next/link';
import { Icon } from '@esoko/ui';

export default function Home() {
  return (
    <div>
      <div className="page-hero">
        <div className="wrap">
          <div className="kicker"><Icon name="shop" size={12} />Esoko Store</div>
          <h1>Sell online, in person, and get paid your usual way.</h1>
          <p className="sub">Open a store on your Esoko account, list what you sell, and take payment by M-Pesa — online through your storefront, or in person on the PoS terminal.</p>
          <div className="lockup"><span className="dot" />Trusted by Kenyan traders</div>
        </div>
      </div>
      <div className="wrap" style={{ paddingTop: 48, paddingBottom: 60 }}>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link href="/dashboard/new" className="btn btn-g">
            <Icon name="plus" size={16} />Open your store
          </Link>
          <Link href="/dashboard" className="btn btn-o">
            Go to your dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}