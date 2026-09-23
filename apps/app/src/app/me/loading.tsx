/**
 * Navigation skeleton — shown for the ~200ms while the record rehydrates
 * on each page move. Mirrors the dashboard's real skeleton so the shift
 * from "loading" to "loaded" is a fill, not a jump.
 */
export default function MeLoading() {
  return (
    <div className="skel" role="status" aria-label="Loading your record">
      {/* The hero carries the title now, so the skeleton's title lives
          inside the band rather than above it — otherwise the heading
          visibly jumps down one block on hydrate. */}
      <div className="skel-standing">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="skel-kicker" />
          <div className="skel-title" />
          <div className="skel-line" style={{ width: '82%' }} />
        </div>
        <span className="skel-ring" />
      </div>

      <div className="skel-quick">
        {[0, 1, 2, 3].map((i) => <div key={i} />)}
      </div>

      <div className="skel-grid">
        {[0, 1, 2, 3].map((i) => (
          <div className="skel-tile" key={i}>
            <div className="skel-box" style={{ width: 30, height: 30 }} />
            <div className="skel-line" style={{ width: '60%', height: 9 }} />
            <div className="skel-line" style={{ width: '80%', height: 14 }} />
          </div>
        ))}
      </div>

      <div className="skel-card">
        <div className="skel-line" style={{ width: '40%', height: 15 }} />
        {[0, 1, 2].map((i) => (
          <div className="skel-row" key={i}>
            <div className="skel-line" style={{ width: '30%', height: 11 }} />
            <div className="skel-line" style={{ width: '55%', height: 11 }} />
          </div>
        ))}
      </div>
    </div>
  );
}