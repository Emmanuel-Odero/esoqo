import Link from 'next/link';
import { Icon } from '@esoko/ui';
import { getGroup, getGroupAnalytics, listDocumentsForParty } from '@esoko/db';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';

const FEE_LABEL: Record<string, string> = {
  group: 'Group covers it',
  self: 'Paid independently',
  unknown: 'Not yet answered',
};

export default async function GroupDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;

  const group = await getGroup(ctx, id);
  if (!group) {
    return (
      <div className="card">
        <p className="empty">This group could not be found.</p>
      </div>
    );
  }

  const [analytics, documents] = await Promise.all([
    getGroupAnalytics(ctx, id),
    listDocumentsForParty(ctx, id),
  ]);

  const maxMonth = Math.max(1, ...analytics.joinedByMonth.map((m) => m.count));
  const totalFeeAnswers = analytics.feeCoverage.reduce((n, f) => n + f.count, 0);

  return (
    <>
      <div className="head">
        <div>
          <Link href="/groups" className="sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <Icon name="arrow-left" size={14} />Back to groups
          </Link>
          <h1>
            {group.knownAs || group.officialName}
            {group.party.sourceSystem === 'CECF' && (
              <span className="pill p-info" style={{ marginLeft: 8, fontSize: '.65rem', verticalAlign: 'middle' }}
                title="Registered via the CECF WordPress site">
                CECF
              </span>
            )}
          </h1>
          <p>
            {group.party.county} · {group.kind.replace(/_/g, ' ').toLowerCase()}
            {group.registrationNo && <> · registered ({group.registrationNo})</>}
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="users" size={16} />
          </span>
          <span className="n">{group.members.length}</span>
          <span className="l">Active members</span>
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>
            <Icon name="document" size={16} />
          </span>
          <span className="n">{documents.length}</span>
          <span className="l">Documents on file</span>
        </div>
        <div className="kpi a">
          <span className="ico" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }}>
            <Icon name="coins" size={16} />
          </span>
          <span className="n">
            {totalFeeAnswers
              ? `${analytics.feeCoverage.find((f) => f.coverage === 'group')?.count ?? 0}/${totalFeeAnswers}`
              : '—'}
          </span>
          <span className="l">Fees group-covered</span>
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 22 }}>
        <div className="card">
          <h2>Member growth</h2>
          {analytics.joinedByMonth.length === 0 ? (
            <p className="empty">No members yet.</p>
          ) : (
            <table className="tbl">
              <tbody>
                {analytics.joinedByMonth.map((m) => (
                  <tr key={String(m.month)}>
                    <td>{new Date(m.month).toLocaleDateString('en-KE', { year: 'numeric', month: 'short' })}</td>
                    <td className="mono" style={{ width: 50 }}>{m.count}</td>
                    <td style={{ width: '45%' }}>
                      <div className="bar"><span style={{ width: `${(m.count / maxMonth) * 100}%` }} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Registration fee coverage</h2>
          <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
            Individuals who linked themselves to this group during their own registration.
          </p>
          {analytics.feeCoverage.length === 0 ? (
            <p className="empty">No one has linked a registration to this group yet.</p>
          ) : (
            <table className="tbl">
              <tbody>
                {analytics.feeCoverage.map((f) => (
                  <tr key={f.coverage}>
                    <td>{FEE_LABEL[f.coverage] ?? f.coverage}</td>
                    <td className="mono" style={{ width: 50 }}>{f.count}</td>
                    <td style={{ width: '45%' }}>
                      <div className="bar">
                        <span style={{
                          width: `${(f.count / totalFeeAnswers) * 100}%`,
                          background: f.coverage === 'group' ? 'var(--green)' : f.coverage === 'self' ? 'var(--blue)' : 'var(--amber)',
                        }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Members</h2>
        {group.members.length === 0 ? (
          <p className="empty">Nobody has joined this group yet.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Role</th><th>Joined</th></tr></thead>
            <tbody>
              {group.members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.person.person?.officialName || m.person.person?.knownAs || 'Unnamed'}</strong>
                    {m.person.person?.officialName && m.person.person?.knownAs && (
                      <span className="sub" style={{ display: 'block', fontSize: '.79rem' }}>
                        Known as {m.person.person.knownAs}
                      </span>
                    )}
                  </td>
                  <td className="sub">{m.role === 'OTHER' ? (m.customRole || 'Other') : m.role}</td>
                  <td className="mono sub" style={{ fontSize: '.79rem' }}>{m.joinedAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
