import type { Metadata } from 'next';
import Link from 'next/link';
import { actionGetParcelReceipt } from '../../parcels/actions';

/**
 * The short public receipt page every "Receipt for this parcel" SMS
 * link points to — /t/[code]'s payment-facing sibling, same short-path
 * reasoning (see that page's own comment on the 160-character SMS
 * budget) and same bearer-credential convention: the tracking code
 * printed on the box is what unlocks it.
 *
 * Deliberately a separate route from /t/, not a tab on it: a receipt
 * only exists once a parcel has actually been paid for, so this page
 * has its own not-found state ("no receipt yet") rather than
 * overloading the tracker's "parcel not found" message for a parcel
 * that exists but hasn't been settled.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ code: string }> },
): Promise<Metadata> {
  const { code } = await params;
  return {
    title: `Receipt ${code.toUpperCase()} — Esoqo`,
    robots: { index: false, follow: false },
  };
}

function formatKES(amount: string | null): string {
  if (!amount) return '—';
  const n = Number(amount);
  return Number.isFinite(n) ? `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '—';
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}

function paymentMethodLabel(method: string | null, mpesaCode: string | null): string {
  if (mpesaCode) return `M-Pesa (${mpesaCode})`;
  if (method === 'PAY_AT_COUNTER') return 'Cash at the counter';
  if (method === 'MPESA_STK') return 'M-Pesa';
  if (method === 'ESOKO_POINTS') return 'Esoqo points';
  return method ?? '—';
}

export default async function ParcelReceiptPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const res = await actionGetParcelReceipt(code.toUpperCase());
  const upper = code.toUpperCase();

  return (
    <section className="sec">
      <div className="wrap" style={{ maxWidth: 480 }}>
        {res.kind === 'found' ? (
          <div className="card">
            {res.receipt.orgLogoUrl ? (
              <img
                src={res.receipt.orgLogoUrl}
                alt={res.receipt.orgName ?? 'Courier'}
                style={{ height: 32, marginBottom: 12 }}
              />
            ) : null}
            <h2 style={{ marginTop: 0 }}>Receipt</h2>
            <p className="sub" style={{ margin: '0 0 16px' }}>
              <span className="mono">{res.receipt.code}</span>
              {res.receipt.orgName ? ` · ${res.receipt.orgName}` : ''}
            </p>

            <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 12px', margin: 0 }}>
              <dt className="sub">From</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{res.receipt.originLabel}</dd>
              <dt className="sub">To</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{res.receipt.destinationLabel}</dd>
              <dt className="sub">Sender</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{res.receipt.senderName}</dd>
              <dt className="sub">Receiver</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{res.receipt.receiverName}</dd>
              <dt className="sub">Paid</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{formatWhen(res.receipt.paidAt)}</dd>
              <dt className="sub">Payment method</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>
                {paymentMethodLabel(res.receipt.paymentMethod, res.receipt.mpesaReceiptCode)}
              </dd>
              <dt style={{ fontWeight: 700 }}>Amount paid</dt>
              <dd className="mono" style={{ margin: 0, textAlign: 'right', fontWeight: 700 }}>
                {formatKES(res.receipt.priceKes)}
              </dd>
            </dl>

            <p className="sub" style={{ marginTop: 16, fontSize: '.85rem' }}>
              <Link href={`/t/${res.receipt.code}`}>Track this parcel</Link>
            </p>
          </div>
        ) : res.kind === 'not-found' ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>No receipt yet</h2>
            <p className="sub">
              The code <span className="mono">{upper}</span> hasn&apos;t been paid for yet, or doesn&apos;t
              match anything. Once a parcel is settled, its receipt appears here.
            </p>
            <Link className="btn btn-o btn-sm" href={`/t/${upper}`}>Track this parcel instead</Link>
          </div>
        ) : (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>We couldn&apos;t load that receipt</h2>
            <p className="sub">{res.error}</p>
          </div>
        )}
      </div>
    </section>
  );
}
