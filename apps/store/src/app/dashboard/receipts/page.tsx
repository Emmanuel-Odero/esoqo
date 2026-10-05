import type { Metadata } from 'next';
import Link from 'next/link';
import { listMyStores, listReceiptsNeedingItems } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { Icon } from '@esoqo/ui';

export const metadata: Metadata = { title: 'Receipts' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');
const dateFmt = (d: Date) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Same landing every other section gets from the sidebar — no separate
 * "itemization" tool to learn. The only thing on it today is the list a
 * BusinessPayment lands on with money already in but nothing said about
 * what it was for (see issueReceiptFor in dal/receipt.ts); a PosSale or
 * StoreOrder receipt never appears here because it already has items
 * from the moment it's issued.
 */
export default async function ReceiptsPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const pending = await listReceiptsNeedingItems(ctx, store.id);

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>Receipts</h1>
          <p className="sub">{pending.length} need{pending.length === 1 ? 's' : ''} items</p>
        </div>
      </div>
      {pending.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <Icon name="print" size={28} style={{ color: 'var(--tx-3)', marginBottom: 12 }} />
          <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>
            Nothing needs items right now — a payment made before the buyer said what they
            bought will show up here.
          </p>
        </div>
      ) : (
        <div className="card tbl-wrap" style={{ padding: 0 }}>
          <table className="dtbl">
            <thead><tr><th>Receipt</th><th>Buyer</th><th>Phone</th><th>Amount</th><th>When</th><th>Status</th><th /></tr></thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.receiptCode ?? r.receiptNo}</td>
                  <td>{r.businessPayment?.payerName || '—'}</td>
                  <td className="mono">{r.businessPayment?.payerMsisdn}</td>
                  <td className="mono">{kes(Number(r.totalKes))}</td>
                  <td>{dateFmt(r.issuedAt)}</td>
                  <td><span className="pill draft">Needs items</span></td>
                  <td>
                    <Link href={`/dashboard/receipts/${r.id}/itemize`} className="btn btn-o btn-sm">
                      Add items <Icon name="arrow-right" size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
