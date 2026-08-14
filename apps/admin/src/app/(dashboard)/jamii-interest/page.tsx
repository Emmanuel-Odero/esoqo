import { Icon } from '@esoko/ui';
import { listJamiiInterests } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { InterestTable } from './InterestTable';

export const dynamic = 'force-dynamic';

/**
 * "Not yet a CECF member" leads from Our Jamii (apps/jamii's
 * /signin/set-pin flow) — see @esoko/db's createJamiiInterest for why
 * this is its own queue rather than folded into Registrations.
 */
export default async function JamiiInterestPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const rows = await listJamiiInterests(ctx, {
    status: sp.status as never,
    search: sp.q,
  });
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  const canWrite = ctx.capabilities.includes('*') || ctx.capabilities.includes('jamii-interest.write');

  return (
    <>
      <div className="head">
        <div>
          <h1>Our Jamii — interest</h1>
          <p>
            People who tried to sign in or set a PIN on Our Jamii with a phone or email that
            isn&rsquo;t an existing CECF member. Follow up, then either point them to CECF&rsquo;s
            own join process or dismiss.
          </p>
        </div>
      </div>

      <div className="kpis">
        {([
          ['clock', 'a', by('NEW'), 'New'],
          ['phone-call', 'b', by('CONTACTED'), 'Contacted'],
          ['check-circle', 'g', by('CONVERTED'), 'Converted'],
          ['ban', 'r', by('DISMISSED'), 'Dismissed'],
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

      <InterestTable
        rows={rows.map((r) => ({
          id: r.id,
          status: r.status,
          fullName: r.fullName,
          msisdn: r.msisdn,
          email: r.email,
          county: r.county,
          organisationName: r.organisationName,
          message: r.message,
          reviewNote: r.reviewNote,
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        }))}
        canWrite={canWrite}
        q={sp.q ?? ''}
        status={sp.status ?? ''}
      />
    </>
  );
}
