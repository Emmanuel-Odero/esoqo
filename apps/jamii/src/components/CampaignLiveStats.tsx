'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from '@esoqo/ui';
import { CampaignDonateButton } from './CampaignDonateButton';
import { actionGetCampaignLiveStats, type CampaignLiveStats as LiveStats } from '@/lib/campaign-live-actions';

const POLL_MS = 7000;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'D';
}

const LiveContext = createContext<{ live: LiveStats; freshIds: Set<string> } | null>(null);

/**
 * Wraps the whole ledger-panel + "Recent supporters" region (which the
 * page's server-rendered layout keeps in two different places — ledger
 * in the sidebar, supporters wall in the main column) and polls
 * actionGetCampaignLiveStats every few seconds, so a donation shows up
 * for everyone already on the page, not just on their next reload.
 * Context rather than each piece polling on its own — one poll, both
 * pieces stay in sync instead of drifting a few hundred ms apart.
 *
 * Confirmation can land from either apps/jamii's own donate()
 * (console-mode auto-confirm) or services/core's Daraja webhook — both
 * write to the same Postgres, so polling sees either path with no
 * extra plumbing between the two processes.
 */
export function CampaignLiveProvider({
  campaignId, initial, children,
}: { campaignId: string; initial: LiveStats; children: React.ReactNode }) {
  const [live, setLive] = useState(initial);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const knownIds = useRef(new Set(initial.donations.map((d) => d.id)));

  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(async () => {
      // Considerate polling — a backgrounded tab doesn't need to keep
      // hitting the server every 7s for a number nobody's looking at.
      if (document.visibilityState !== 'visible') return;
      const next = await actionGetCampaignLiveStats(campaignId);
      if (cancelled) return;

      const arrived = next.donations.filter((d) => !knownIds.current.has(d.id)).map((d) => d.id);
      if (arrived.length > 0) {
        knownIds.current = new Set(next.donations.map((d) => d.id));
        setFreshIds(new Set(arrived));
        setTimeout(() => setFreshIds(new Set()), 4000);
      }
      setLive(next);
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [campaignId]);

  return <LiveContext.Provider value={{ live, freshIds }}>{children}</LiveContext.Provider>;
}

function useLive() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('LedgerPanel/SupportersWall must be inside CampaignLiveProvider');
  return ctx;
}

export function LedgerPanel({
  campaignId, campaignTitle, goalKes, daysLeft, active, verified,
}: {
  campaignId: string; campaignTitle: string; goalKes: number;
  daysLeft: number | null; active: boolean; verified: boolean;
}) {
  const { live } = useLive();
  const pct = goalKes > 0 ? Math.min(100, Math.round((live.raisedKes / goalKes) * 100)) : 0;

  return (
    <aside>
      <div className="ledgerpanel">
        <div className="amt-row">
          <span className="raised mono">KES {live.raisedKes.toLocaleString('en-KE')}</span>
          <span className="goal">raised of KES {goalKes.toLocaleString('en-KE')} goal</span>
        </div>
        <div className="ledgerbar"><div className="fill" style={{ width: `${pct}%`, transition: 'width .6s ease' }} /></div>
        <div className="lp-meta">
          <span>{live.supporters} supporters</span>
          <span>{daysLeft !== null ? `${daysLeft} days left` : 'Ongoing'}</span>
        </div>
        {active ? (
          <CampaignDonateButton campaignId={campaignId} campaignTitle={campaignTitle} />
        ) : (
          <p style={{ fontSize: '.85rem', color: '#6b6552' }}>This campaign has ended.</p>
        )}
      </div>
      {verified && (
        <div className="card" style={{ padding: 18, marginTop: 18 }}>
          <span className="verified-inline"><Icon name="shield-check" size={13} /> Organisation verified</span>
          <p style={{ fontSize: '.82rem', color: '#6b6552', marginTop: 10 }}>
            Registration documents reviewed by CECF staff.
          </p>
        </div>
      )}
    </aside>
  );
}

export function SupportersWall() {
  const { live, freshIds } = useLive();
  if (live.donations.length === 0) return <p>Be the first to support this campaign.</p>;
  return (
    <ul className="receiptwall">
      {live.donations.map((d) => (
        <li key={d.id} className={freshIds.has(d.id) ? 'rw-fresh' : undefined}>
          <span className="rw-who">
            <span className="rw-avatar">{d.anonymous ? 'A' : initials(d.donorName)}</span>
            {d.anonymous ? 'Anonymous' : d.donorName}
          </span>
          <span className="rw-amt mono">KES {d.amountKes.toLocaleString('en-KE')}</span>
          <span className="rw-time">{d.confirmedAt ? new Date(d.confirmedAt).toLocaleDateString('en-KE') : ''}</span>
        </li>
      ))}
    </ul>
  );
}
