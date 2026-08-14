import { Icon } from '@esoko/ui';
import { listDonationsForStaff, getDonationTotalsForStaff } from '@esoko/db';
import { maskMsisdn } from '@esoko/domain';
import { requireStaff } from '@/lib/session';
import { DonationTable } from './DonationTable';

export const dynamic = 'force-dynamic';

/** Read-only oversight — money on Our Jamii moves through the same
 *  M-Pesa STK + balanced-ledger path as everywhere else on the
 *  platform (see @esoko/db's confirmDonationPayment); nothing here
 *  writes to a donation directly. */
export default async function JamiiDonationsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const [{ rows }, totals] = await Promise.all([
    listDonationsForStaff(ctx, { status: sp.status as never, search: sp.q, take: 100 }),
    getDonationTotalsForStaff(ctx),
  ]);
  const canSeePii = ctx.capabilities.includes('*') || ctx.capabilities.includes('party.pii');

  return (
    <>
      <div className="head">
        <div>
          <h1>Our Jamii — donations</h1>
          <p>Every gift made to a campaign, platform-wide — for reconciliation and dispute follow-up.</p>
        </div>
      </div>

      <div className="kpis">
        {([
          ['coins', 'g', `KES ${totals.raisedKes.toLocaleString('en-KE')}`, 'Confirmed, total'],
          ['check-circle', 'g', totals.confirmed, 'Confirmed'],
          ['clock', 'a', totals.pending, 'Pending'],
          ['alert-circle', 'r', totals.failed, 'Failed'],
        ] as const).map(([icon, tone, n, label]) => {
          const c = { g: 'green', b: 'blue', a: 'amber', r: 'red' }[tone];
          return (
            <div className={`kpi ${tone}`} key={label}>
              <span className="ico" style={{ background: `var(--${c}-t)`, color: `var(--${c})` }}>
                <Icon name={icon} size={16} />
              </span>
              <span className="n">{n}</span><span className="l">{label}</span>
            </div>
          );
        })}
      </div>

      <DonationTable
        rows={rows.map((d) => ({
          id: d.id,
          status: d.status,
          donorName: d.donorName,
          donorMsisdn: canSeePii ? d.donorMsisdn : maskMsisdn(d.donorMsisdn),
          anonymous: d.anonymous,
          amountKes: Number(d.amountKes),
          campaignTitle: d.campaign.title,
          orgName: d.campaign.page.organisation.officialName,
          receiptCode: d.receiptCode,
          createdAt: d.createdAt.toISOString(),
        }))}
        q={sp.q ?? ''}
        status={sp.status ?? ''}
      />
    </>
  );
}
