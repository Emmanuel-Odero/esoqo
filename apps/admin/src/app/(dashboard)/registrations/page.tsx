import { Icon } from '@esoko/ui';
import { listRegistrations, getOverview, getFunnel, DOCUMENT_KINDS } from '@esoko/db';
import { COUNTIES } from '@esoko/domain';
import { requireStaff } from '@/lib/session';
import { DonutChart, Gauge } from '@/components/charts';
import { RegistrationTable } from './RegistrationTable';
import { LiveRefresh } from './LiveRefresh';

const STATUS_LABEL: Record<string, string> = {
  STARTED: 'Started', AWAITING_OTP: 'Awaiting OTP', VERIFIED: 'Verified',
  COMPLETE: 'Complete', ABANDONED: 'Abandoned',
};
const STATUS_COLOR: Record<string, string> = {
  STARTED: 'var(--tx-3)', AWAITING_OTP: 'var(--amber)', VERIFIED: 'var(--blue)',
  COMPLETE: 'var(--green-2)', ABANDONED: 'var(--red)',
};

export const dynamic = 'force-dynamic';

export default async function RegistrationsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; county?: string; status?: string; page?: string; type?: string; source?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const take = 25;
  const type = sp.type === 'organisations' || sp.type === 'individuals' ? sp.type : undefined;
  const source = sp.source === 'CECF' || sp.source === 'ESOKO' ? sp.source : undefined;

  const [{ rows, total }, overview, funnel] = await Promise.all([
    listRegistrations(ctx, {
      search: sp.q, county: sp.county, status: sp.status as never, type, source,
      take, skip: (page - 1) * take,
    }),
    getOverview(ctx),
    getFunnel(ctx),
  ]);

  const caps = ctx.capabilities;
  const can = (c: string) => caps.includes('*') || caps.includes(c);

  return (
    <>
      <div className="head">
        <div>
          <h1>Registrations</h1>
          <p>
            {total.toLocaleString()} records. Phone numbers are masked unless you hold{' '}
            <code className="mono">party.pii</code>. Voiding keeps the audit trail — nothing here
            is ever hard-deleted.
          </p>
        </div>
        <div className="actions"><LiveRefresh /></div>
      </div>

      <div className="kpis">
        {([
          ['check-circle', 'g', overview.registrationsComplete, 'Joined', `${overview.last24h} in 24h`],
          ['clock', 'a', overview.awaitingOtp, 'Stuck at OTP', 'Code sent, never confirmed'],
          ['ban', 'r', overview.abandoned, 'Abandoned or void', 'Excluded from all counts'],
        ] as const).map(([icon, tone, n, label, sub]) => {
          const c = { g: 'green', b: 'blue', a: 'amber', r: 'red' }[tone];
          return (
            <div className={`kpi ${tone}`} key={label}>
              <span className="ico" style={{ background: `var(--${c}-t)`, color: `var(--${c})` }}>
                <Icon name={icon} size={16} />
              </span>
              <span className="n">{n}</span>
              <span className="l">{label}</span>
              <span className="sub">{sub}</span>
            </div>
          );
        })}
        <div className="kpi" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Gauge pct={overview.completionRate} size={68} color="var(--blue)" />
          <div>
            <span className="l" style={{ display: 'block' }}>Completion rate</span>
            <span className="sub" style={{ display: 'block', marginTop: 4 }}>{overview.registrationsStarted} started</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <h2><Icon name="chart" size={18} />Every registration, by stage</h2>
        <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
          Not just those matching the filter below — the whole funnel, platform-wide.
        </p>
        <DonutChart size={160}
          centerLabel={{ value: funnel.reduce((n, s) => n + s.count, 0).toLocaleString('en-KE'), sub: 'registrations' }}
          segments={funnel.map((s) => ({ label: STATUS_LABEL[s.status] ?? s.status, value: s.count, color: STATUS_COLOR[s.status] ?? 'var(--tx-3)' }))
            .filter((s) => s.value > 0)} />
      </div>

      <RegistrationTable
        rows={rows.map((r) => ({
          id: r.id, officialName: r.officialName, knownAs: r.knownAs,
          orgName: r.orgName, bizName: r.bizName, msisdn: r.msisdn, county: r.county,
          workRaw: r.workRaw, status: r.status, joiningAs: r.joiningAs,
          path: r.path,
          startedAt: r.startedAt.toISOString(),
          voidedAt: r.voidedAt?.toISOString() ?? null,
          voidReason: r.voidReason,
          // Which group/business this row is actually attached to,
          // whichever way it got there — typed as a brand-new name
          // (orgName/bizName) or picked as an existing one via search
          // (groupPartyId/bizPartyId, named through the relation since
          // the registration row itself never captured that name).
          groupPartyId: r.groupPartyId,
          groupOrgName: r.groupParty?.organisation?.officialName ?? null,
          bizPartyId: r.bizPartyId,
          bizOrgName: r.bizParty?.organisation?.officialName ?? null,
          belongsToGroup: r.belongsToGroup,
          groupName: r.groupName,
          lastStep: r.lastStep,
          feeCoverage: r.feeCoverage,
        }))}
        total={total}
        page={page}
        pages={Math.max(1, Math.ceil(total / take))}
        counties={[...COUNTIES]}
        type={type}
        source={source}
        q={sp.q ?? ''}
        county={sp.county ?? ''}
        status={sp.status ?? ''}
        canEdit={can('registration.write')}
        canVoid={can('registration.void')}
        canCreate={can('registration.create')}
        canSeePii={can('party.pii')}
        canRecordPayment={can('payment.record')}
        canAssignUser={can('party.credential')}
        canManageMembership={can('membership.write')}
        canUploadDocs={can('registration.write')}
        documentKinds={DOCUMENT_KINDS as unknown as [string, string][]}
      />
    </>
  );
}
