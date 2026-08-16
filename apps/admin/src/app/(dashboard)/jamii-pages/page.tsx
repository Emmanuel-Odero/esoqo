import { Icon } from '@esoko/ui';
import { listJamiiPagesForStaff, getJamiiPageCounts } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { PageTable } from './PageTable';

export const dynamic = 'force-dynamic';

/**
 * Every Our Jamii community page, any status — the counterpart to
 * apps/jamii's self-service dashboard (which only ever shows a person
 * their own pages). See @esoko/db's listJamiiPagesForStaff.
 */
export default async function JamiiPagesPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const [{ rows }, counts] = await Promise.all([
    listJamiiPagesForStaff(ctx, { status: sp.status as never, search: sp.q, take: 100 }),
    getJamiiPageCounts(ctx),
  ]);
  const canModerate = ctx.capabilities.includes('*') || ctx.capabilities.includes('jamii-page.moderate');
  const canVerify = ctx.capabilities.includes('*') || ctx.capabilities.includes('attestation.issue');
  const canManageTeam = ctx.capabilities.includes('*') || ctx.capabilities.includes('party.write');

  return (
    <>
      <div className="head">
        <div>
          <h1>Our Jamii — pages</h1>
          <p>
            Every community group&rsquo;s public mini-site, whatever its status. Publish, suspend or
            verify from here — day-to-day editing stays with the page&rsquo;s own team.
          </p>
        </div>
      </div>

      <div className="kpis">
        {([
          ['document', 'a', counts.draft, 'Draft'],
          ['check-circle', 'g', counts.published, 'Published'],
          ['ban', 'r', counts.suspended, 'Suspended'],
          ['handshake', 'b', counts.total, 'Total'],
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

      <PageTable
        rows={rows.map((p) => ({
          id: p.organisationId,
          slug: p.slug,
          status: p.status,
          officialName: p.organisation.officialName,
          county: p.organisation.party.county,
          verified: p.organisation.party.attestations.length > 0,
          teamCount: p.team.length,
          activeCampaigns: p.campaigns.filter((c) => c.status === 'ACTIVE').length,
          createdAt: p.createdAt.toISOString(),
        }))}
        canModerate={canModerate}
        canVerify={canVerify}
        canManageTeam={canManageTeam}
        q={sp.q ?? ''}
        status={sp.status ?? ''}
      />
    </>
  );
}
