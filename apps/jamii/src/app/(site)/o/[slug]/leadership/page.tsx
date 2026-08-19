import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { getOrgLinkMode } from '@/lib/org-links';
import { buildOrgMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [page, mode] = await Promise.all([loadOrgOr404(slug), getOrgLinkMode(slug)]);
  return buildOrgMetadata(page, mode, { path: 'leadership', titleSuffix: 'Team & governance' });
}

const ROLE_LABEL: Record<string, string> = {
  CHAIRPERSON: 'Chairperson', TREASURER: 'Treasurer', SECRETARY: 'Secretary',
  MEMBER: 'Member', OTHER: 'Committee member',
};

export default async function LeadershipPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);
  const mode = await getOrgLinkMode(slug);
  const onCustomDomain = mode.base === '';
  const leaders = page.organisation.members.filter((m) => m.role !== 'MEMBER');

  return (
    <OrgSectionShell
      slug={slug} title="Team & governance" eyebrow="Team & governance" noSidebar
      lede={onCustomDomain ? 'Our leadership committee, and how we stay accountable to the people we serve and the people who support us.' : undefined}
    >
      {leaders.length === 0 ? (
        <p className={onCustomDomain ? 'wl-lede' : undefined}>Leadership hasn&rsquo;t been listed yet.</p>
      ) : onCustomDomain ? (
        <>
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
          <div className="wl-tbl-wrap">
            <table className="wl-tbl">
              <thead><tr><th>Role</th><th>Name</th></tr></thead>
              <tbody>
                {leaders.map((m) => {
                  const p = m.person.person;
                  const name = p?.knownAs || p?.officialName || 'Member';
                  return (
                    <tr key={m.id}>
                      <td className="role">{m.customRole || ROLE_LABEL[m.role] || m.role}</td>
                      <td>{name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <section className="osec">
          <h2>Leadership</h2>
          <div className="leadgrid">
            {leaders.map((m) => {
              const p = m.person.person;
              const name = p?.knownAs || p?.officialName || 'Member';
              const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
              return (
                <div key={m.id} className="card leadcard">
                  <div className="la" aria-hidden="true">{initials}</div>
                  <h4>{name}</h4>
                  <span>{m.customRole || ROLE_LABEL[m.role] || m.role}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </OrgSectionShell>
  );
}
