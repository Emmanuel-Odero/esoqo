import Link from 'next/link';
import { getCampaignStats } from '@esoko/db';
import { orgHref, type OrgLinkMode } from '@/lib/org-links-shared';
import { OrgDonateBand } from './OrgDonateBand';
import type { getJamiiPageBySlug } from '@esoko/db';

type OrgPage = NonNullable<Awaited<ReturnType<typeof getJamiiPageBySlug>>>;

/**
 * Everything on the homepage below OrgHomeHero — ported from the
 * template's own home page structure: an impact ticker, a teaser grid
 * linking out to the other sections, whichever campaign is live, and
 * the closing partner/donate band. The template's home page is
 * deliberately lean (it leaves programme detail, team, etc. to their
 * own pages) — this follows that rather than re-inventing a longer
 * homepage.
 */
export async function OrgHomeSections({ page, mode }: { page: OrgPage; mode: OrgLinkMode }) {
  const org = page.organisation;
  const activeCampaign = page.campaigns.find((c) => c.status === 'ACTIVE');
  const campaignStats = activeCampaign ? await getCampaignStats(activeCampaign.id) : null;

  return (
    <>
      <div className="wl-ticker-wrap">
        <div className="wl-ticker">
          <div className="wl-stat"><div className="num">{org.party.county}</div><div className="label">Based in</div></div>
          <div className="wl-stat"><div className="num">{page.programs.length}</div><div className="label">Programmes running</div></div>
          <div className="wl-stat"><div className="num">{page.campaigns.length}</div><div className="label">Campaigns to date</div></div>
          <div className="wl-stat"><div className="num">{org.members?.length || org.memberCount || '—'}</div><div className="label">Members</div></div>
        </div>
      </div>

      <section className="wl-section">
        <div className="wl-section-inner">
          <div className="wl-sec-head">
            <span className="wl-eyebrow">Explore</span>
            <h2>Find out more about our work</h2>
          </div>
          <div className="wl-teaser-grid">
            <Link className="wl-teaser-card" href={orgHref(mode, 'about')}>
              <h3>Who we are</h3>
              <p>Our mission, vision and the difference we're working to make.</p>
              <span className="go">Read more →</span>
            </Link>
            <Link className="wl-teaser-card" href={orgHref(mode, 'programs')}>
              <h3>Programmes</h3>
              <p>{page.programs.length > 0 ? `${page.programs.length} programme areas we run.` : 'What we do, in practice.'}</p>
              <span className="go">Read more →</span>
            </Link>
            <Link className="wl-teaser-card" href={orgHref(mode, 'leadership')}>
              <h3>Team</h3>
              <p>Leadership, governance and how we stay accountable.</p>
              <span className="go">Read more →</span>
            </Link>
            <Link className="wl-teaser-card" href={orgHref(mode, 'contact')}>
              <h3>Contact us</h3>
              <p>Phone, email, address and how to give.</p>
              <span className="go">Read more →</span>
            </Link>
          </div>
        </div>
      </section>

      {activeCampaign && campaignStats && (
        <section className="wl-section wl-section-alt">
          <div className="wl-section-inner">
            <div className="wl-partner-band" style={{ background: 'var(--wl-surface)', color: 'var(--wl-ink)', border: '1px solid var(--wl-surface-line)' }}>
              <div>
                <span className="wl-eyebrow">Active campaign</span>
                <h2 style={{ marginTop: 10 }}>{activeCampaign.title}</h2>
                <p className="wl-lede">{activeCampaign.summary}</p>
                <Link href={orgHref(mode, `c/${activeCampaign.slug}`)} className="wl-cta" style={{ marginTop: 22 }}>
                  Support this campaign
                </Link>
              </div>
              <div className="wl-jamii-card" style={{ background: 'var(--wl-bg-alt)', border: '1px solid var(--wl-surface-line)' }}>
                {(() => {
                  const goal = Number(activeCampaign.goalKes);
                  const pct = goal > 0 ? Math.min(100, Math.round((campaignStats.raisedKes / goal) * 100)) : 0;
                  return (
                    <>
                      <div className="amt-row">
                        <span className="raised mono">KES {campaignStats.raisedKes.toLocaleString('en-KE')}</span>
                        <span className="goal">raised of KES {goal.toLocaleString('en-KE')} goal</span>
                      </div>
                      <div className="ledgerbar"><div className="fill" style={{ width: `${pct}%` }} /></div>
                      <div className="lp-meta"><span>{campaignStats.supporters} supporters</span></div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="wl-section">
        <div className="wl-section-inner">
          <OrgDonateBand
            mode={mode}
            heading="Ways to partner"
            body="Fund a programme, offer attachments or employment, provide technical support, or co-deliver where your reach and ours overlap."
            listItems={[
              'A named contact and a written agreement setting out what each side will do',
              "Reporting on an agreed schedule — honest reporting when something doesn't go to plan",
            ]}
            panelBody="A public page — who we are, what we're raising for, and a receipt for every shilling given, sent straight to the donor's phone. Verified by CECF staff."
          />
        </div>
      </section>
    </>
  );
}
