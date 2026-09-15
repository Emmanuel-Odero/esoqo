import { Icon } from '@esoqo/ui';
import { listPayments, getPaymentStats, listApprovers, PAYMENT_APPROVAL_THRESHOLD } from '@esoqo/db';
import { requireStaff } from '@/lib/session';
import { DonutChart } from '@/components/charts';
import { PaymentQueue } from './PaymentQueue';

export const dynamic = 'force-dynamic';

const TONE = { g: 'green', b: 'blue', a: 'amber', r: 'red' } as const;

export default async function PaymentsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;

  const [{ rows, total }, stats, approvers] = await Promise.all([
    listPayments(ctx, { status: sp.status as never, search: sp.q, take: 50 }),
    getPaymentStats(ctx),
    listApprovers(ctx),
  ]);

  const by = (s: string) => stats.find((x) => x.status === s);
  const canApprove = ctx.capabilities.includes('*') || ctx.capabilities.includes('payment.approve');

  return (
    <>
      <div className="head">
        <div>
          <h1>Payments</h1>
          <p>
            A declaration is not money. A payment moves to confirmed only after{' '}
            <strong>{PAYMENT_APPROVAL_THRESHOLD} signatures from different approvers</strong>, and
            nobody may approve a payment they recorded themselves.
          </p>
        </div>
      </div>

      <div className="kpis">
        {([
          ['DECLARED', 'a', 'clock', 'Awaiting signature'],
          ['UNDER_REVIEW', 'b', 'scales', 'Part-signed'],
          ['CONFIRMED', 'g', 'check-circle', 'Confirmed'],
          ['REJECTED', 'r', 'ban', 'Rejected'],
        ] as const).map(([status, tone, icon, label]) => (
          <div className={`kpi ${tone}`} key={status}>
            <span className="ico" style={{
              background: `var(--${TONE[tone]}-t)`, color: `var(--${TONE[tone]})`,
            }}>
              <Icon name={icon} size={16} />
            </span>
            <span className="n">{by(status)?.count ?? 0}</span>
            <span className="l">{label}</span>
            {by(status)?.totalKes ? (
              <span className="sub mono">KES {by(status)!.totalKes.toLocaleString('en-KE')}</span>
            ) : null}
          </div>
        ))}
      </div>

      {stats.some((s) => s.count > 0) && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2><Icon name="scales" size={17} />Status split</h2>
          <DonutChart size={150} segments={[
            { label: 'Awaiting signature', value: by('DECLARED')?.count ?? 0, color: 'var(--amber)' },
            { label: 'Part-signed', value: by('UNDER_REVIEW')?.count ?? 0, color: 'var(--blue)' },
            { label: 'Confirmed', value: by('CONFIRMED')?.count ?? 0, color: 'var(--green-2)' },
            { label: 'Rejected', value: by('REJECTED')?.count ?? 0, color: 'var(--red)' },
          ].filter((s) => s.value > 0)} />
        </div>
      )}

      {!canApprove && (
        <div className="chain" style={{ background: 'var(--blue-t)', border: '1px solid #C8DDEC', color: 'var(--blue)' }}>
          <Icon name="info" size={18} />
          <span>
            You can see these payments but not sign them. Approval requires the{' '}
            <code className="mono">payment.approve</code> permission, granted by a super admin.
          </span>
        </div>
      )}

      <PaymentQueue
        rows={rows.map((r) => ({
          id: r.id, status: r.status, reference: r.reference, amountKes: r.amountKes,
          method: r.method, declaredAt: r.declaredAt?.toISOString() ?? null,
          approveCount: r.approveCount,
          signatures: r.approvals.map((a) => ({
            name: a.approver.name, decision: a.decision, at: a.signedAt.toISOString(),
          })),
          person: r.registration.knownAs || r.registration.officialName || '—',
          county: r.registration.county ?? '—',
        }))}
        total={total}
        threshold={PAYMENT_APPROVAL_THRESHOLD}
        canApprove={canApprove}
        approverCount={approvers.length}
      />
    </>
  );
}
