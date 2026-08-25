import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoko/ui';
import { listMyStores, listDebts } from '@esoko/db';
import { requireSubject } from '@/lib/session';

export const metadata: Metadata = { title: 'Debts' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');
const dateFmt = (d: Date) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
const daysSince = (d: Date) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));

export default async function DebtsPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const debts = await listDebts(ctx, store.id);
  const totalOwed = debts.reduce((n, d) => n + d.balanceKes, 0);

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>Debts</h1>
          <p className="sub">
            {debts.length === 0
              ? 'Nobody owes the shop anything right now.'
              : `${debts.length} customer${debts.length !== 1 ? 's' : ''} owing ${kes(totalOwed)} in total`}
          </p>
        </div>
      </div>

      {debts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <Icon name="coins" size={28} style={{ color: 'var(--tx-3)', marginBottom: 12 }} />
          <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>
            No outstanding credit — a debt shows up here the moment a PoS sale is rung up &ldquo;On account&rdquo;.
          </p>
        </div>
      ) : (
        <div className="card tbl-wrap" style={{ padding: 0 }}>
          <table className="dtbl">
            <thead><tr><th>Customer</th><th>Phone</th><th>Owing since</th><th>Amount owed</th><th /></tr></thead>
            <tbody>
              {debts.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.orgName ? (
                      <><Icon name="handshake" size={13} style={{ marginRight: 5, color: 'var(--tx-3)' }} />{d.orgName}</>
                    ) : (d.name ?? '—')}
                  </td>
                  <td className="mono">{d.msisdn}</td>
                  <td>
                    {d.owingSinceAt ? (
                      <>{dateFmt(d.owingSinceAt)} <span style={{ color: 'var(--tx-3)' }}>· {daysSince(d.owingSinceAt)}d</span></>
                    ) : '—'}
                  </td>
                  <td className="mono"><span className="pill paused">{kes(d.balanceKes)}</span></td>
                  <td><Link href={`/dashboard/customers/${d.id}`} className="btn btn-o btn-sm">Record payment</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
