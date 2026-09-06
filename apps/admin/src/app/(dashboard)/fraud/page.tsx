import { notFound } from 'next/navigation';
import { AuthorisationError } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { adminGo } from '@/lib/go-ticketing';

export const dynamic = 'force-dynamic';

type Summary = {
  windowHours: number; totalVerifications: number; valid: number;
  expired: number; notFound: number; wrongTrip: number; suspectReuse: number; pending: number;
  topSuspects: { fareId: string; amountKes: string; receiptCode?: string | null; tripId: string; verifyCount: number }[];
  recentExpired: { fareId: string; result: string; scopeTripId?: string | null; occurredAt: string }[];
};

/** Ops: 24h verify outcomes + reuse suspects (3+ shows) + flagged attempts. Read-only. */
export default async function FraudPage() {
  await requireStaff();
  let summary: Summary | null = null;
  let error: string | null = null;
  try {
    const res = await adminGo<{ summary: Summary }>('/v1/admin/fraud/summary');
    summary = res.summary;
  } catch (e) {
    if (e instanceof AuthorisationError) notFound();
    error = e instanceof Error ? e.message : 'Could not load fraud summary.';
  }
  if (error || !summary) {
    return (<><h1>Fare fraud</h1><div className="note n-red"><div><p>{error}</p></div></div></>);
  }
  const s = summary;
  const stat = (label: string, v: number) => (
    <div className="mcard" style={{ flex: 1, minWidth: 120 }}><h2>{v}</h2><p>{label}</p></div>
  );
  return (
    <>
      <h1>Fare fraud</h1>
      <p>Verification outcomes, last {s.windowHours}h. Reuse suspects = fares shown 3+ times (screenshot sharing). Verify-only — freezing/voiding runs through support tooling.</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
        {stat('Total', s.totalVerifications)}{stat('Valid', s.valid)}{stat('Expired', s.expired)}
        {stat('Wrong bus', s.wrongTrip)}{stat('Suspect reuse', s.suspectReuse)}{stat('Not found', s.notFound)}
      </div>
      <div className="mcard">
        <h2>Reuse suspects</h2>
        {s.topSuspects.length === 0 && <p>No fares at 3+ shows. Healthy.</p>}
        {s.topSuspects.map((t) => (
          <div key={t.fareId} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
            <p className="mono">{t.fareId.slice(0, 8)} · KES {t.amountKes} · {t.verifyCount}× · receipt {t.receiptCode ?? '—'}</p>
          </div>
        ))}
      </div>
      <div className="mcard">
        <h2>Flagged attempts</h2>
        {s.recentExpired.length === 0 && <p>Nothing flagged recently.</p>}
        {s.recentExpired.map((r, i) => (
          <div key={`${r.fareId}-${i}`} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
            <p className="mono">{r.result} · {r.fareId.slice(0, 8)} · {r.occurredAt}</p>
          </div>
        ))}
      </div>
    </>
  );
}
