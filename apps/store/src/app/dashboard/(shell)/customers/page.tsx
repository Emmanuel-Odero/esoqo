import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { listMyStores, listCustomers } from '@esoqo/db';
import { requireSubject } from '@/lib/session';

export const metadata: Metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

export default async function CustomersPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const customers = await listCustomers(ctx, store.id);
  const totalOwed = customers.reduce((n, c) => n + Math.max(0, c.balanceKes), 0);

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>Customers</h1>
          <p className="sub">{customers.length} customer{customers.length !== 1 ? 's' : ''} on file{totalOwed > 0 ? ` · ${kes(totalOwed)} owed on credit` : ''}</p>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <Icon name="users" size={28} style={{ color: 'var(--tx-3)', marginBottom: 12 }} />
          <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>
            No customers yet — they're captured automatically the moment a phone number is on a sale or order.
          </p>
        </div>
      ) : (
        <div className="card tbl-wrap" style={{ padding: 0 }}>
          <table className="dtbl">
            <thead><tr><th>Name</th><th>Phone</th><th>Balance</th><th>Points</th><th /></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.orgName ? (
                      <>
                        <Icon name="handshake" size={13} style={{ marginRight: 5, color: 'var(--tx-3)' }} />
                        {c.orgName}
                        {c.name && <span className="sub" style={{ display: 'block', fontSize: '.78rem' }}>via {c.name}</span>}
                      </>
                    ) : (c.name ?? '—')}
                  </td>
                  <td className="mono">{c.msisdn}</td>
                  <td className="mono">
                    {c.balanceKes > 0
                      ? <span className="pill paused">Owes {kes(c.balanceKes)}</span>
                      : c.balanceKes < 0
                        ? <span className="pill live">Credit {kes(-c.balanceKes)}</span>
                        : <span style={{ color: 'var(--tx-3)' }}>Settled</span>}
                  </td>
                  <td className="mono">{c.points}</td>
                  <td><Link href={`/dashboard/customers/${c.id}`} className="btn btn-o btn-sm">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
