import { Icon } from '@esoko/ui';
import { listStaff, CAPABILITY_CATALOGUE, ROLE_PRESETS } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { StaffTable } from './StaffTable';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const ctx = await requireStaff();
  const staff = await listStaff(ctx);
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('staff.capabilities');

  return (
    <>
      <div className="head">
        <div>
          <h1>Staff &amp; permissions</h1>
          <p>
            Roles are presets of capabilities, not a separate model — so any account can be
            hand-tuned. You cannot grant a permission you do not hold yourself, and you cannot
            edit your own.
          </p>
        </div>
      </div>

      <div className="kpis">
        {([
          ['users', 'b', staff.filter((s) => s.active).length, 'Active accounts'],
          ['key', 'g', staff.filter((s) => s.capabilities.includes('payment.approve') || s.capabilities.includes('*')).length, 'Can sign payments'],
          ['shield', 'a', staff.filter((s) => s.capabilities.includes('*')).length, 'Super admins'],
          ['ban', 'r', staff.filter((s) => !s.active).length, 'Suspended'],
        ] as const).map(([icon, tone, n, label]) => {
          const c = { g: 'green', b: 'blue', a: 'amber', r: 'red' }[tone];
          return (
            <div className={`kpi ${tone}`} key={label}>
              <span className="ico" style={{ background: `var(--${c}-t)`, color: `var(--${c})` }}>
                <Icon name={icon} size={16} />
              </span>
              <span className="n">{n}</span>
              <span className="l">{label}</span>
            </div>
          );
        })}
      </div>

      <StaffTable
        staff={staff.map((s) => ({
          id: s.id, name: s.name, email: s.email,
          rolePreset: s.rolePreset ?? 'CUSTOM',
          capabilities: s.capabilities, active: s.active,
          approvals: s._count.approvals,
          lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
          mustChangePin: s.mustChangePin,
        }))}
        catalogue={CAPABILITY_CATALOGUE as never}
        presets={Object.keys(ROLE_PRESETS)}
        canEdit={canEdit}
        selfId={ctx.actorId}
      />
    </>
  );
}
