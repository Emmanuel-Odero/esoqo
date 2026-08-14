import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  CHAIRPERSON: 'Chairperson', TREASURER: 'Treasurer', SECRETARY: 'Secretary',
  MEMBER: 'Member', OTHER: 'Committee member',
};

export default async function LeadershipPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);
  const leaders = page.organisation.members.filter((m) => m.role !== 'MEMBER');

  return (
    <OrgSectionShell slug={slug} noSidebar>
      <section className="osec">
        <h2>Leadership</h2>
        {leaders.length === 0 ? (
          <p>Leadership hasn&rsquo;t been listed yet.</p>
        ) : (
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
        )}
      </section>
    </OrgSectionShell>
  );
}
