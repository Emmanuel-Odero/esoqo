import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { listMyStores, listShifts } from '@esoqo/db';
import { requireSubject } from '@/lib/session';

export const metadata: Metadata = { title: 'Shifts' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');
const dateFmt = (d: Date) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default async function ShiftsPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const shifts = await listShifts(ctx, store.id);

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>Shifts</h1>
          <p className="sub">Every till open/close, with the cash reconciliation from the moment it was counted.</p>
        </div>
      </div>

      {shifts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <Icon name="clock" size={28} style={{ color: 'var(--tx-3)', marginBottom: 12 }} />
          <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>No shifts yet — a cashier checking in at the PoS terminal opens one.</p>
        </div>
      ) : (
        <div className="card tbl-wrap" style={{ padding: 0 }}>
          <table className="dtbl">
            <thead><tr><th>Cashier</th><th>Opened</th><th>Closed</th><th>Variance</th><th>Status</th><th /></tr></thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td>{s.cashier.name}</td>
                  <td>{dateFmt(s.openedAt)}</td>
                  <td>{s.closedAt ? dateFmt(s.closedAt) : '—'}</td>
                  <td className="mono" style={{ color: s.varianceKes === null ? 'var(--tx-3)' : Number(s.varianceKes) === 0 ? 'var(--green)' : 'var(--red)' }}>
                    {s.varianceKes === null ? '—' : `${Number(s.varianceKes) >= 0 ? '+' : ''}${kes(Number(s.varianceKes))}`}
                  </td>
                  <td><span className={`pill ${s.status === 'OPEN' ? 'draft' : 'live'}`}>{s.status === 'OPEN' ? 'Open' : 'Closed'}</span></td>
                  <td><Link href={`/dashboard/shifts/${s.id}`} className="btn btn-o btn-sm">Z-report</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
