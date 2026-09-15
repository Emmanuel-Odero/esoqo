'use client';
import { useState } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { lookupCertificate, type VerifyResult } from './actions';

export function VerifyForm() {
  const [code, setCode] = useState('');
  const [res, setRes] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const announce = useAnnounce();

  async function check(v: string) {
    setCode(v.toUpperCase());
    if (v.trim().length < 4) { setRes(null); return; }
    setBusy(true);
    const r = await lookupCertificate(v);
    setRes(r);
    setBusy(false);
    announce(r.found ? `${r.status}. ${r.claimType} issued by ${r.issuer}` : 'No certificate with that code', 'assertive');
  }

  const tone = res?.found
    ? { valid: 'var(--green)', expiring: 'var(--amber)', expired: 'var(--red)', revoked: '#5A2A2A' }[res.status]
    : 'var(--red)';

  return (
    <>
      <div className="fin-in" style={{ marginBottom: 16 }}>
        <span className="mg"><Icon name="qr" size={22} /></span>
        <input
          value={code} maxLength={16} autoComplete="off"
          aria-label="Certificate code" aria-describedby="verify-result"
          onChange={(e) => check(e.target.value)}
          placeholder="0000-AAA-0000"
          style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textAlign: 'center', textTransform: 'uppercase', fontSize: '1.3rem', padding: '22px 24px 22px 58px' }}
        />
      </div>

      <div id="verify-result" aria-live="polite">
        {busy && <p className="sub" style={{ textAlign: 'center' }}>Checking…</p>}

        {!busy && res?.found && (
          <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--sh-m)' }}>
            <div style={{ background: tone, color: '#fff', padding: '22px 26px', display: 'flex', gap: 16, alignItems: 'center' }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,.22)', display: 'grid', placeItems: 'center' }}>
                <Icon name={res.status === 'valid' ? 'check-circle' : res.status === 'expiring' ? 'clock' : res.status === 'revoked' ? 'ban' : 'alert-circle'} size={26} />
              </span>
              <div>
                <div className="mono" style={{ fontSize: '.7rem', letterSpacing: '.18em', textTransform: 'uppercase', opacity: .9 }}>
                  {{ valid: 'Valid', expiring: 'Valid — expiring soon', expired: 'Expired', revoked: 'Revoked by issuer' }[res.status]}
                </div>
                <h2 style={{ color: '#fff', fontSize: '1.35rem', marginTop: 2 }}>{res.claimType}</h2>
              </div>
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '9px 16px', padding: '24px 26px', margin: 0, fontSize: '.93rem' }}>
              <dt style={{ color: 'var(--tx-2)' }}>Holder</dt><dd style={{ margin: 0, fontWeight: 600 }}>{res.holder}</dd>
              <dt style={{ color: 'var(--tx-2)' }}>Issued by</dt><dd style={{ margin: 0, fontWeight: 600 }}>{res.issuer}</dd>
              <dt style={{ color: 'var(--tx-2)' }}>Issued on</dt><dd style={{ margin: 0, fontWeight: 600 }}>{res.issuedOn}</dd>
              <dt style={{ color: 'var(--tx-2)' }}>Valid until</dt><dd style={{ margin: 0, fontWeight: 600 }}>{res.validUntil ?? 'No expiry'}</dd>
            </dl>
          </div>
        )}

        {!busy && res && !res.found && (
          <div className="note n-red" style={{ display: 'block', textAlign: 'center', padding: 26 }}>
            <h2 style={{ color: '#96201F', marginBottom: 8, fontSize: '1.1rem' }}>
              No certificate with that code
            </h2>
            <p style={{ margin: 0, color: '#7A2320', fontSize: '.93rem' }}>
              Check each character and try again. If the code is correct as printed, this
              certificate was not issued through Esoqo.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
