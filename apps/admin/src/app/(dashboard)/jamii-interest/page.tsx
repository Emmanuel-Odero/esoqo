import { Icon } from '@esoqo/ui';
import { listJamiiInterests } from '@esoqo/db';
import { requireStaff } from '@/lib/session';
import { DonutChart } from '@/components/charts';
import { InterestTable } from './InterestTable';

export const dynamic = 'force-dynamic';

/**
 * Applications for Our Jamii access (apps/jamii's /apply flow) — see
 * @esoqo/db's createJamiiInterest for why this is its own queue rather
 * than folded into Registrations. Approving one is what actually grants
 * sign-in access — see approveJamiiInterest.
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
          <h1>Our Jamii — applications</h1>
          <p>
            People who applied for Our Jamii access, whether they were already a CECF member or
            brand new. Approving one grants sign-in — for a new applicant, it also creates their account.
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

      {rows.length > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2><Icon name="users" size={17} />Status split</h2>
          <DonutChart size={150} centerLabel={{ value: String(rows.length), sub: 'applications' }} segments={[
            { label: 'New', value: by('NEW'), color: 'var(--amber)' },
            { label: 'Contacted', value: by('CONTACTED'), color: 'var(--blue)' },
            { label: 'Converted', value: by('CONVERTED'), color: 'var(--green-2)' },
            { label: 'Dismissed', value: by('DISMISSED'), color: 'var(--red)' },
          ].filter((s) => s.value > 0)} />
        </div>
      )}

      <InterestTable
        rows={rows.map((r) => ({
          id: r.id,
          status: r.status,
          fullName: r.fullName,
          msisdn: r.msisdn,
          email: r.email,
          county: r.county,
          organisationName: r.organisationName,
          matched: Boolean(r.personId),
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
