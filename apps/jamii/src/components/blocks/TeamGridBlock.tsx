import type { BlockProps } from './types';

interface TeamGridData {
  heading?: string;
}

const ROLE_LABEL: Record<string, string> = {
  CHAIRPERSON: 'Chairperson', TREASURER: 'Treasurer', SECRETARY: 'Secretary',
  MEMBER: 'Member', OTHER: 'Committee member',
};

/** Reads live from the org's Membership rows (officers only, same
 *  filter as the Leadership page) — see ProgramsListBlock's header
 *  comment for why this doesn't copy the data into the block itself. */
export function TeamGridBlock({ page, data }: BlockProps<TeamGridData>) {
  const leaders = page.organisation.members.filter((m) => m.role !== 'MEMBER');
  if (leaders.length === 0) return null;

  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        {data.heading?.trim() && <h2 style={{ marginBottom: 20 }}>{data.heading}</h2>}
        <div className="wl-team-grid">
          {leaders.map((m) => {
            const p = m.person.person;
            const name = p?.knownAs || p?.officialName || 'Member';
            const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
            return (
              <div key={m.id} className="wl-team-card">
                <div className="wl-team-avatar" aria-hidden="true">{initials}</div>
                <h4>{name}</h4>
                <div className="wl-team-role">{m.customRole || ROLE_LABEL[m.role] || m.role}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
