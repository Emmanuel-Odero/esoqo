import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';
import { listMyStores, listCashiers } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { CashierForm } from './CashierForm';
import { CashierRow } from './CashierRow';
import { CashierSignInLink } from './CashierSignInLink';

export const metadata: Metadata = { title: 'Cashiers' };
export const dynamic = 'force-dynamic';

const dateFmt = (d: Date) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function CashiersPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const cashiers = await listCashiers(ctx, store.id);

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>Cashiers</h1>
          <p className="sub">Who can check in at the terminal, and open or close a shift.</p>
        </div>
      </div>

      <CashierForm storeId={store.id} />
      {cashiers.length > 0 && <CashierSignInLink storeSlug={store.slug} />}

      {cashiers.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <Icon name="users" size={28} style={{ color: 'var(--tx-3)', marginBottom: 12 }} />
          <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>No cashiers yet — add one so sales can be attributed to whoever's on the till.</p>
        </div>
      ) : (
        <div className="card tbl-wrap" style={{ padding: 0 }}>
          <table className="dtbl">
            <thead><tr><th>Name</th><th>Role</th><th>Added</th><th>Status</th><th /></tr></thead>
            <tbody>
              {cashiers.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.role === 'MANAGER' ? 'Manager' : 'Cashier'}</td>
                  <td>{dateFmt(c.createdAt)}</td>
                  <td><span className={`pill ${c.active ? 'live' : 'paused'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                  <td><CashierRow id={c.id} active={c.active} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
