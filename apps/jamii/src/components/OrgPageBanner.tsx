/**
 * The interior-page header for custom-domain sites — About, Programmes,
 * Leadership, and every other section under OrgSectionShell. Ported
 * from the template's `.page-intro`: plain text on the page's own
 * background, not a coloured band — the homepage's hero (OrgHomeHero)
 * is the one place that earns the full treatment.
 */
export function OrgPageBanner({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <div className="wl-page-intro">
      <div className="wl-page-intro-inner">
        <span className="wl-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {lede && <p className="wl-lede">{lede}</p>}
      </div>
    </div>
  );
}
