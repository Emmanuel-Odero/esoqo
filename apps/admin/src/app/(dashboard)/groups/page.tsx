import { Icon } from '@esoqo/ui';
import { listGroups, DOCUMENT_KINDS, GROUP_KINDS } from '@esoqo/db';
import { COUNTIES } from '@esoqo/domain';
import { requireStaff } from '@/lib/session';
import { RankedBarChart, DonutChart } from '@/components/charts';
import { GroupManager } from './GroupManager';

export const dynamic = 'force-dynamic';

export default async function GroupsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const groups = await listGroups(ctx, { search: sp.q });
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('membership.write');
  const canUploadDocs = ctx.capabilities.includes('*') || ctx.capabilities.includes('document.write');
  const canCreate = ctx.capabilities.includes('*') || ctx.capabilities.includes('party.write');

  return (
    <>
      <div className="head">
        <div>
          <h1>Groups</h1>
          <p>
            Chamas, self-help groups, cooperatives and SACCOs. Removing a member is a soft exit —
            they keep their contribution history, because a group's books have to stay true.
          </p>
        </div>
      </div>

      <div className="kpis">
        {([
          ['handshake', 'b', groups.length, 'Groups'],
          ['users', 'g', groups.reduce((n, g) => n + g.members.length, 0), 'Active memberships'],
          ['shield', 'a', groups.filter((g) => g.registrationNo).length, 'Registered'],
          ['pin', 'b', new Set(groups.map((g) => g.party.county)).size, 'Counties'],
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

      {groups.length > 0 && (
        <div className="grid2" style={{ marginBottom: 22 }}>
          <div className="card">
            <h2><Icon name="handshake" size={17} />By kind</h2>
            <RankedBarChart color="var(--navy-2)" rows={
              [...groups.reduce((m, g) => m.set(g.kind, (m.get(g.kind) ?? 0) + 1), new Map<string, number>())]
                .map(([kind, count]) => ({ label: kind.replace(/_/g, ' ').toLowerCase(), value: count }))
            } />
          </div>
          <div className="card">
            <h2><Icon name="gov" size={17} />Registration channel</h2>
            <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
              CECF registrations come through the CECF WordPress site&rsquo;s own flow, not this
              platform&rsquo;s — an active, ongoing channel, not a one-off import.
            </p>
            <DonutChart size={150} centerLabel={{ value: String(groups.length), sub: 'groups' }} segments={[
              { label: 'CECF', value: groups.filter((g) => g.party.sourceSystem === 'CECF').length, color: 'var(--amber)' },
              { label: 'Esoqo app', value: groups.filter((g) => g.party.sourceSystem === 'ESOKO').length, color: 'var(--green-2)' },
            ].filter((s) => s.value > 0)} />
          </div>
        </div>
      )}

      <GroupManager
        groups={groups.map((g) => ({
          id: g.partyId,
          name: g.officialName ?? 'Unnamed group',
          knownAs: g.knownAs ?? null,
          kind: g.kind,
          county: g.party.county,
          sourceSystem: g.party.sourceSystem,
          registrationNo: g.registrationNo ?? null,
          members: g.members.map((m) => ({
            membershipId: m.id,
            partyId: m.personId,
            name: m.person.person?.officialName || m.person.person?.knownAs || 'Unnamed',
            knownAs: m.person.person?.officialName ? (m.person.person?.knownAs ?? null) : null,
            phone: m.person.person?.msisdn ?? null,
            role: m.role,
            customRole: m.customRole,
            joinedAt: m.joinedAt.toISOString(),
          })),
        }))}
        canEdit={canEdit}
        canUploadDocs={canUploadDocs}
        canCreate={canCreate}
        documentKinds={DOCUMENT_KINDS as unknown as [string, string][]}
        groupKinds={GROUP_KINDS as unknown as [string, string][]}
        counties={[...COUNTIES]}
      />
    </>
  );
}
