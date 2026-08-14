import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { loadCampaign, loadCampaignExtras, isVerified } from '@/lib/data';
import { CampaignDonateButton } from '@/components/CampaignDonateButton';

export const dynamic = 'force-dynamic';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'D';
}

export default async function CampaignPage({
  params,
}: { params: Promise<{ slug: string; campaignSlug: string }> }) {
  const { slug, campaignSlug } = await params;
  const campaign = await loadCampaign(slug, campaignSlug);
  if (!campaign) notFound();

  const { stats, donations } = await loadCampaignExtras(campaign.id);
  const goal = Number(campaign.goalKes);
  const pct = goal > 0 ? Math.min(100, Math.round((stats.raisedKes / goal) * 100)) : 0;
  const org = campaign.page.organisation;
  const daysLeft = campaign.endsAt ? Math.max(0, Math.ceil((campaign.endsAt.getTime() - Date.now()) / 86_400_000)) : null;

  return (
    <>
      <div className="campherowrap">
        <div className="wrap">
          <Link href={`/o/${slug}`} className="campback">← {org.officialName}</Link>
          <h1>{campaign.title}</h1>
          <p className="campbyline">A campaign by <Link href={`/o/${slug}`}>{org.officialName}</Link> · {org.party.county}</p>
          <div className="camp-hero-img">{campaign.coverUrl && <img src={campaign.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
        </div>
      </div>

      <div className="wrap camplayout">
        <div>
          <section className="osec">
            <h2>About this project</h2>
            {campaign.body
              ? campaign.body.split('\n\n').map((para, i) => <p key={i}>{para}</p>)
              : <p>{campaign.summary}</p>}
          </section>

          {campaign.updates.length > 0 && (
            <section className="osec">
              <h2>Updates</h2>
              {campaign.updates.map((u) => (
                <div key={u.id} className="card updatecard">
                  <div className="udate">{u.postedAt.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                  <h4>{u.title}</h4>
                  <p>{u.body}</p>
                </div>
              ))}
            </section>
          )}

          <section className="osec" style={{ marginBottom: 0 }}>
            <h2>Recent supporters</h2>
            {donations.length === 0 ? (
              <p>Be the first to support this campaign.</p>
            ) : (
              <ul className="receiptwall">
                {donations.map((d) => (
                  <li key={d.id}>
                    <span className="rw-who">
                      <span className="rw-avatar">{d.anonymous ? 'A' : initials(d.donorName)}</span>
                      {d.anonymous ? 'Anonymous' : d.donorName}
                    </span>
                    <span className="rw-amt mono">KES {Number(d.amountKes).toLocaleString('en-KE')}</span>
                    <span className="rw-time">{d.confirmedAt?.toLocaleDateString('en-KE') ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside>
          <div className="ledgerpanel">
            <div className="amt-row">
              <span className="raised mono">KES {stats.raisedKes.toLocaleString('en-KE')}</span>
              <span className="goal">raised of KES {goal.toLocaleString('en-KE')} goal</span>
            </div>
            <div className="ledgerbar"><div className="fill" style={{ width: `${pct}%` }} /></div>
            <div className="lp-meta">
              <span>{stats.supporters} supporters</span>
              <span>{daysLeft !== null ? `${daysLeft} days left` : 'Ongoing'}</span>
            </div>
            {campaign.status === 'ACTIVE' ? (
              <CampaignDonateButton campaignId={campaign.id} campaignTitle={campaign.title} />
            ) : (
              <p style={{ fontSize: '.85rem', color: '#6b6552' }}>This campaign has ended.</p>
            )}
          </div>
          {isVerified(org) && (
            <div className="card" style={{ padding: 18, marginTop: 18 }}>
              <span className="verified-inline"><Icon name="shield-check" size={13} /> Organisation verified</span>
              <p style={{ fontSize: '.82rem', color: '#6b6552', marginTop: 10 }}>
                Registration documents reviewed by CECF staff.
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
