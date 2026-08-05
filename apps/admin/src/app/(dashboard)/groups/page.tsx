import { Icon } from '@esoko/ui';
import { listGroups, DOCUMENT_KINDS, GROUP_KINDS } from '@esoko/db';
import { COUNTIES } from '@esoko/domain';
import { requireStaff } from '@/lib/session';
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

      <GroupManager
        groups={groups.map((g) => ({
          id: g.partyId,
          name: g.officialName ?? 'Unnamed group',
          knownAs: g.knownAs ?? null,
          kind: g.kind,
          county: g.party.county,
          registrationNo: g.registrationNo ?? null,
          members: g.members.map((m) => ({
            membershipId: m.id,
            partyId: m.personId,
            name: m.person.person?.knownAs || m.person.person?.officialName || 'Unnamed',
            role: m.role,
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
