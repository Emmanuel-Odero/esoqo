import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReceipt } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { PrintButton } from './PrintButton';

export const metadata: Metadata = { title: 'Receipt' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');
const dateFmt = (d: Date) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSubject();

  let receipt;
  try {
    receipt = await getReceipt(ctx, id);
  } catch {
    notFound();
  }

  const items = receipt.sale?.items ?? receipt.order?.items ?? [];
  const soldAt = receipt.sale?.soldAt ?? receipt.order?.createdAt ?? receipt.issuedAt;
  const cashierName = receipt.sale?.cashier?.name;

  return (
    <div style={{ maxWidth: 380, margin: '32px auto', padding: '0 16px' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>
      <div className="no-print"><PrintButton /></div>
      <div className="card" style={{ fontFamily: 'var(--font-mono)', fontSize: '.85rem' }}>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: '1rem' }}>{receipt.store.name}</strong>
          <div style={{ color: 'var(--tx-2)', fontSize: '.78rem' }}>Receipt {receipt.receiptNo}</div>
          <div style={{ color: 'var(--tx-3)', fontSize: '.74rem' }}>{dateFmt(soldAt)}</div>
          {cashierName && <div style={{ color: 'var(--tx-3)', fontSize: '.74rem' }}>Served by {cashierName}</div>}
        </div>
        <div style={{ borderTop: '1px dashed var(--line)', borderBottom: '1px dashed var(--line)', padding: '10px 0', margin: '10px 0' }}>
          {items.map((item) => {
            const variantLabel = 'variant' in item && item.variant ? ` — ${item.variant.label}` : '';
            return (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>{item.product.name}{variantLabel} ×{item.quantity}</span>
                <span>{kes(Number(item.unitPriceKes) * item.quantity)}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '.95rem' }}>
          <span>Total</span><span>{kes(Number(receipt.totalKes))}</span>
        </div>
        {receipt.etimsSerial && (
          <div style={{ textAlign: 'center', marginTop: 14, fontSize: '.72rem', color: 'var(--tx-2)' }}>
            KRA eTIMS: {receipt.etimsSerial}
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: 14, fontSize: '.72rem', color: 'var(--tx-3)' }}>
          Powered by Esoko
        </div>
      </div>
    </div>
  );
}
