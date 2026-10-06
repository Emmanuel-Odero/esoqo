/**
 * Navigation skeleton — mirrors /me exactly to prevent layout shift.
 * Mast + quick row + bento (main + aside) so load→paint is a fill, not a jump.
 */
export default function MeLoading() {
  return (
    <div className="skel" role="status" aria-live="polite" aria-label="Loading home">
      <div className="skel-mast">
        <div className="skel-kicker" />
        <div className="skel-title" />
        <div className="skel-line" style={{ width: '70%', height: 11 }} />
        <div className="skel-line" style={{ width: 140, height: 36, marginTop: 12, borderRadius: 10 }} />
      </div>

      <div className="skel-grid2">
        <div>
          <div className="skel-quick">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} aria-hidden="true" />
            ))}
          </div>
          <div className="skel-card">
            <div className="skel-line" style={{ width: '40%', height: 14 }} />
            {[0, 1].map((i) => (
              <div className="skel-row" key={i}>
                <div className="skel-line" style={{ width: '55%', height: 11 }} />
                <div className="skel-line" style={{ width: 64, height: 32, borderRadius: 10, marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        </div>

        <div className="skel-card" aria-hidden="true">
          <div className="skel-line" style={{ width: '46%', height: 14 }} />
          {[0, 1, 2, 3].map((i) => (
            <div className="skel-row" key={i}>
              <div className="skel-box" style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--paper)' }} />
              <div style={{ flex: 1 }}>
                <div className="skel-line" style={{ width: '62%', height: 10 }} />
                <div className="skel-line" style={{ width: '84%', height: 9, marginTop: 6 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
