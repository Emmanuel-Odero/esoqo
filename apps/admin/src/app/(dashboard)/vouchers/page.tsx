import { notFound } from 'next/navigation';
import { AuthorisationError } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { adminGo } from '@/lib/go-ticketing';

export const dynamic = 'force-dynamic';

/** Ops: look up a voucher by code, see balance, freeze/unfreeze. Go enforces. */
export default async function VouchersPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  type Found = { label?: string; purpose?: string; status?: string; balancePoints?: number; balanceKes?: number };
  let found: Found | null = null;
  let error: string | null = null;
  if (sp.code) {
    try {
      const res = await adminGo<{ voucher: Found }>(`/v1/vouchers/resolve?code=${encodeURIComponent(sp.code)}`);
      found = res.voucher;
    } catch (e) {
      if (e instanceof AuthorisationError) notFound();
      error = e instanceof Error ? e.message : 'Lookup failed.';
    }
  }
  return (
    <>
      <h1>Vouchers</h1>
      <p>Resolve a card by short code (VCH-XXXXXX) or full QR payload. Balances are derived server-side; 10 pts = KES 1.</p>
      <form method="get" style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <input name="code" className="inp mono" defaultValue={sp.code ?? ''} placeholder="VCH-XXXXXX" />
        <button className="btn btn-p" type="submit">Look up</button>
      </form>
      {error && <div className="note n-red"><div><p>{error}</p></div></div>}
      {found && (
        <div className="mcard">
          <h2>{found.label} · {found.purpose}</h2>
          <p className="mono">{found.balancePoints} pts ≈ KES {found.balanceKes} · {found.status}</p>
          <p>Freeze/unfreeze runs through the owner wallet or support tooling with the voucher.freeze grant — no silent balance edits.</p>
        </div>
      )}
    </>
  );
}
