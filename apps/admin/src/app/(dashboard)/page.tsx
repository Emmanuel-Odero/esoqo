import { Icon } from '@esoko/ui';
import {
  getOverview, getFunnel, getStepFunnel, getByCounty, getBySegment,
  getOptInRates, getUssdChoiceSplit, verifyChain,
} from '@esoko/db';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Overview.
 *
 * The metrics are deliberately the ones from the journey-map work.
 * "Total registered" is present but deliberately not the headline —
 * it is the vanity number that made CECF's reporting meaningless.
 * Completion rate and the funnel are what tell you whether onboarding
 * actually works.
 */
export default async function OverviewPage() {
  const ctx = await requireStaff();

  const [o, funnel, stepFunnel, counties, segments, optIn, ussd, chain] = await Promise.all([
    getOverview(ctx), getFunnel(ctx), getStepFunnel(ctx), getByCounty(ctx), getBySegment(ctx),
    getOptInRates(ctx), getUssdChoiceSplit(ctx), verifyChain(),
  ]);
  const maxReached = Math.max(1, ...stepFunnel.map((s) => s.reached));

  const maxCounty = Math.max(1, ...counties.map((c) => c.count));
  const maxSeg = Math.max(1, ...segments.map((s) => s.count));

  return (
    <>
      <div className="head">
        <h1>Overview</h1>
        <p>Live pilot data. Nothing here is seeded or simulated.</p>
      </div>

      <div className={`chain ${chain.ok ? 'ok' : 'bad'}`} role="status">
        <Icon name={chain.ok ? 'shield-check' : 'alert-triangle'} size={18} />
        {chain.ok
          ? `Audit chain intact — ${chain.checked.toLocaleString()} events verified`
          : `AUDIT CHAIN BROKEN at event ${chain.brokenAtId}. Investigate before trusting any report.`}
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="n">{o.registrationsComplete.toLocaleString()}</span>
          <span className="l">Joined</span>
          <span className="sub">{o.last24h} in the last 24h</span>
        </div>
        <div className="kpi">
          <span className="n">{o.completionRate}%</span>
          <span className="l">Completion rate</span>
          <span className="sub">{o.registrationsStarted.toLocaleString()} started</span>
        </div>
        <div className="kpi">
          <span className="n">{o.organisations.toLocaleString()}</span>
          <span className="l">Groups &amp; businesses</span>
          <span className="sub">of {o.parties.toLocaleString()} people</span>
        </div>
        <div className="kpi">
          <span className="n" style={{ color: o.awaitingOtp > 0 ? 'var(--amber)' : undefined }}>
            {o.awaitingOtp}
          </span>
          <span className="l">Stuck at OTP</span>
          <span className="sub">Sent a code, never confirmed</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <h2>Where people actually drop off</h2>
        <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
          Furthest step reached in the join flow — a bar shorter than the one above it is where
          people are leaving. &ldquo;Stuck here&rdquo; is how many are sitting at that step right
          now, not yet complete.
        </p>
        <table className="tbl">
          <thead><tr><th>Step</th><th>Reached</th><th style={{ width: '35%' }} /><th>Stuck here</th></tr></thead>
          <tbody>
            {stepFunnel.map((s) => (
              <tr key={s.step}>
                <td>{s.step}. {s.label}</td>
                <td className="mono">{s.reached}</td>
                <td>
                  <div className="bar">
                    <span style={{ width: `${(s.reached / maxReached) * 100}%` }} />
                  </div>
                </td>
                <td className="mono" style={{ color: s.stuckHere > 0 ? 'var(--amber)' : undefined }}>
                  {s.stuckHere || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ marginBottom: 22 }}>
        <div className="card">
          <h2>By status</h2>
          <table className="tbl">
            <thead><tr><th>Stage</th><th>Count</th><th style={{ width: '40%' }} /></tr></thead>
            <tbody>
              {funnel.map((s) => {
                const pct = o.registrationsStarted
                  ? Math.round((s.count / o.registrationsStarted) * 100) : 0;
                return (
                  <tr key={s.status}>
                    <td>{s.status.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="mono">{s.count}</td>
                    <td>
                      <div className="bar">
                        <span style={{
                          width: `${pct}%`,
                          background: s.status === 'ABANDONED' ? 'var(--red)' : 'var(--green)',
                        }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Dialling access taken up</h2>
          {ussd.length === 0 ? (
            <p className="empty">No completed registrations yet.</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>Choice</th><th>Count</th></tr></thead>
              <tbody>
                {ussd.map((u) => (
                  <tr key={u.choice}>
                    <td>{u.choice === 'now' ? 'Set up now' : u.choice === 'later' ? 'Doing it later' : u.choice}</td>
                    <td className="mono">{u.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2 style={{ marginTop: 22 }}>What people asked us to send</h2>
          <table className="tbl">
            <tbody>
              <tr><td>Morning prices</td><td className="mono">{optIn.price}%</td></tr>
              <tr><td>Payment receipts</td><td className="mono">{optIn.receipt}%</td></tr>
              <tr><td>Certificate expiry</td><td className="mono">{optIn.expiry}%</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>By county</h2>
          {counties.length === 0 ? <p className="empty">No completed registrations yet.</p> : (
            <table className="tbl">
              <tbody>
                {counties.map((c) => (
                  <tr key={c.county}>
                    <td>{c.county}</td>
                    <td className="mono" style={{ width: 60 }}>{c.count}</td>
                    <td style={{ width: '45%' }}>
                      <div className="bar"><span style={{ width: `${(c.count / maxCounty) * 100}%` }} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>What people do</h2>
          {segments.length === 0 ? <p className="empty">No enterprises recorded yet.</p> : (
            <table className="tbl">
              <tbody>
                {segments.map((s) => (
                  <tr key={s.segment}>
                    <td>{s.segment.replace(/-/g, ' ')}</td>
                    <td className="mono" style={{ width: 60 }}>{s.count}</td>
                    <td style={{ width: '45%' }}>
                      <div className="bar">
                        <span style={{ width: `${(s.count / maxSeg) * 100}%`, background: 'var(--blue)' }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
