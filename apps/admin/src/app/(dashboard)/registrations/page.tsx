import { Icon } from '@esoko/ui';
import { listRegistrations, getOverview, DOCUMENT_KINDS } from '@esoko/db';
import { COUNTIES } from '@esoko/domain';
import { requireStaff } from '@/lib/session';
import { RegistrationTable } from './RegistrationTable';

export const dynamic = 'force-dynamic';

export default async function RegistrationsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; county?: string; status?: string; page?: string; type?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const take = 25;
  const type = sp.type === 'organisations' || sp.type === 'individuals' ? sp.type : undefined;

  const [{ rows, total }, overview] = await Promise.all([
    listRegistrations(ctx, {
      search: sp.q, county: sp.county, status: sp.status as never, type,
      take, skip: (page - 1) * take,
    }),
    getOverview(ctx),
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
      </div>

      <div className="kpis">
        {([
          ['check-circle', 'g', overview.registrationsComplete, 'Joined', `${overview.last24h} in 24h`],
          ['clock', 'a', overview.awaitingOtp, 'Stuck at OTP', 'Code sent, never confirmed'],
          ['chart', 'b', `${overview.completionRate}%`, 'Completion rate', `${overview.registrationsStarted} started`],
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
      </div>

      <RegistrationTable
        rows={rows.map((r) => ({
          id: r.id, officialName: r.officialName, knownAs: r.knownAs,
          orgName: r.orgName, msisdn: r.msisdn, county: r.county,
          workRaw: r.workRaw, status: r.status, joiningAs: r.joiningAs,
          startedAt: r.startedAt.toISOString(),
          voidedAt: r.voidedAt?.toISOString() ?? null,
          voidReason: r.voidReason,
        }))}
        total={total}
        page={page}
        pages={Math.max(1, Math.ceil(total / take))}
        counties={[...COUNTIES]}
        type={type}
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
