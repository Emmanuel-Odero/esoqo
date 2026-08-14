'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionRevoke } from './actions';

interface Grant {
  id: string; grantee: string; purpose: string; scope: string[]; wording: string;
  grantedAt: string; expiresAt: string; revokedAt: string | null;
  channel: string; accesses: number;
}

export function ConsentList({ grants }: { grants: Grant[] }) {
  const [confirming, setConfirming] = useState<Grant | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const announce = useAnnounce();

  const active = grants.filter((g) => !g.revokedAt && new Date(g.expiresAt) > new Date());
  const past = grants.filter((g) => g.revokedAt || new Date(g.expiresAt) <= new Date());

  function revoke(g: Grant) {
    start(async () => {
      const r = await actionRevoke(g.id);
      if (r.ok) {
        announce(`${g.grantee} can no longer see your information`, 'assertive');
        setConfirming(null);
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  if (grants.length === 0) {
    return (
      <div className="mcard">
        <div className="mempty">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="shield-check" size={22} />
          </span>
          <h2 style={{ marginBottom: 7 }}>Nobody can see your information</h2>
          <p style={{ margin: 0 }}>
            Not a bank, not a buyer, not a county, not CECF. When you apply for something you will
            be asked, each time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {active.length > 0 && (
        <div className="mcard">
          <h2><Icon name="eye" size={18} />Currently allowed ({active.length})</h2>
          {active.map((g) => (
            <div className="mrow" key={g.id} style={{ alignItems: 'flex-start' }}>
              <span style={{ flex: 1 }}>
                <span className="v" style={{ display: 'block' }}>{g.grantee}</span>
                <span className="hint" style={{ margin: '3px 0 0', display: 'block' }}>
                  For {g.purpose} · until {new Date(g.expiresAt).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}
                  {g.accesses > 0 && ` · looked at ${g.accesses} ${g.accesses === 1 ? 'time' : 'times'}`}
                </span>
                {g.scope.length > 0 && (
                  <span className="hint" style={{ margin: '4px 0 0', display: 'block' }}>
                    They see: {g.scope.join(', ')}
                  </span>
                )}
              </span>
              <button className="btn btn-o" style={{ minHeight: 40, fontSize: '.85rem' }}
                onClick={() => setConfirming(g)} disabled={pending}>
                <Icon name="ban" size={14} />End this
              </button>
            </div>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div className="mcard">
          <h2><Icon name="clock" size={18} />Ended or expired</h2>
          {past.map((g) => (
            <div className="mrow" key={g.id}>
              <span style={{ flex: 1 }}>
                <span className="v" style={{ display: 'block' }}>{g.grantee}</span>
                <span className="hint" style={{ margin: 0 }}>
                  {g.revokedAt
                    ? `You ended this on ${new Date(g.revokedAt).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}`
                    : `Expired ${new Date(g.expiresAt).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}`}
                </span>
              </span>
              <span className="badge b-mute">Ended</span>
            </div>
          ))}
        </div>
      )}

      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}

      {confirming && (
        <div className="scrim" role="presentation"
          style={{ position: 'fixed', inset: 0, background: 'rgba(10,46,77,.55)', display: 'grid', placeItems: 'center', padding: 24, zIndex: 200 }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirming(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="rv-title"
            style={{ background: '#fff', borderRadius: 14, maxWidth: 480, width: '100%', padding: 26 }}>
            <h2 id="rv-title" style={{ marginBottom: 10 }}>
              End {confirming.grantee}’s access?
            </h2>
            <p style={{ color: 'var(--tx-2)', fontSize: '.93rem' }}>
              They stop being able to see your information immediately, and they are told. Anything
              they have already started may stop.
            </p>
            <p style={{ color: 'var(--tx-2)', fontSize: '.93rem' }}>
              Nothing else you hold changes, and you can allow them again later.
            </p>
            <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn btn-o" onClick={() => setConfirming(null)}>Keep it</button>
              <button className="btn btn-p" onClick={() => revoke(confirming)} disabled={pending}>
                <Icon name="ban" size={15} />End access
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
