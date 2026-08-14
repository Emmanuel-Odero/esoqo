import { Icon } from '@esoko/ui';
import { listCampaignsForStaff, getCampaignCountsForStaff } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { CampaignTable } from './CampaignTable';

export const dynamic = 'force-dynamic';

export default async function JamiiCampaignsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const [{ rows }, counts] = await Promise.all([
    listCampaignsForStaff(ctx, { status: sp.status as never, search: sp.q, take: 100 }),
    getCampaignCountsForStaff(ctx),
  ]);
  const canModerate = ctx.capabilities.includes('*') || ctx.capabilities.includes('jamii-campaign.moderate');

  return (
    <>
      <div className="head">
        <div>
          <h1>Our Jamii — campaigns</h1>
          <p>
            Every crowdfunding campaign raised against a community page. Cancel one that looks
            fraudulent or is misrepresenting what it raises for — page teams still run the rest day to day.
          </p>
        </div>
      </div>

      <div className="kpis">
        {([
          ['document', 'a', counts.draft, 'Draft'],
          ['trend-up', 'g', counts.active, 'Active'],
          ['check-circle', 'b', counts.completed, 'Completed'],
          ['ban', 'r', counts.cancelled, 'Cancelled'],
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

      <CampaignTable
        rows={rows.map((c) => ({
          id: c.id,
          slug: c.slug,
          title: c.title,
          status: c.status,
          goalKes: Number(c.goalKes),
          orgName: c.page.organisation.officialName,
          pageSlug: c.page.slug,
          donationCount: c._count.donations,
          createdAt: c.createdAt.toISOString(),
        }))}
        canModerate={canModerate}
        q={sp.q ?? ''}
        status={sp.status ?? ''}
      />
    </>
  );
}
