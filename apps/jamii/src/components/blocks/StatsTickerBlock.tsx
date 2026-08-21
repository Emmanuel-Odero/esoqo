import type { BlockProps } from './types';

/** Extracted verbatim from the pre-Phase-2 OrgHomeSections — no config,
 *  fully computed from `page`/`page.organisation`. */
export function StatsTickerBlock({ page }: BlockProps) {
  const org = page.organisation;
  return (
    <div className="wl-ticker-wrap">
      <div className="wl-ticker">
        <div className="wl-stat"><div className="num">{org.party.county}</div><div className="label">Based in</div></div>
        <div className="wl-stat"><div className="num">{page.programs.length}</div><div className="label">Programmes running</div></div>
        <div className="wl-stat"><div className="num">{page.campaigns.length}</div><div className="label">Campaigns to date</div></div>
        <div className="wl-stat"><div className="num">{org.members?.length || org.memberCount || '—'}</div><div className="label">Members</div></div>
      </div>
    </div>
  );
}
