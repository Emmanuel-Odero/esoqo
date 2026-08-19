import Link from 'next/link';
import { getCampaignStats } from '@esoko/db';
import { orgHref } from '@/lib/org-links-shared';
import type { BlockProps } from './types';

/** Extracted verbatim from the pre-Phase-2 OrgHomeSections. Renders
 *  nothing if there's no ACTIVE campaign — its position in the block
 *  list only matters when there is one; an org can't "configure" this
 *  block beyond where it sits and whether it's hidden. */
export async function ActiveCampaignBlock({ page, mode }: BlockProps) {
  const activeCampaign = page.campaigns.find((c) => c.status === 'ACTIVE');
  const campaignStats = activeCampaign ? await getCampaignStats(activeCampaign.id) : null;
  if (!activeCampaign || !campaignStats) return null;

  const goal = Number(activeCampaign.goalKes);
  const pct = goal > 0 ? Math.min(100, Math.round((campaignStats.raisedKes / goal) * 100)) : 0;

  return (
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
            <div className="amt-row">
              <span className="raised mono">KES {campaignStats.raisedKes.toLocaleString('en-KE')}</span>
              <span className="goal">raised of KES {goal.toLocaleString('en-KE')} goal</span>
            </div>
            <div className="ledgerbar"><div className="fill" style={{ width: `${pct}%` }} /></div>
            <div className="lp-meta"><span>{campaignStats.supporters} supporters</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
