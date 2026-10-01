'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { lookupCode, type LookupCodeResult } from './actions';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

/** `initialCode`, when given, runs the lookup on mount — what the
 *  /verify/[code] SMS-link route passes so a receipt renders immediately,
 *  no typing required. The plain /verify page (someone reading a code
 *  off paper) renders the same component with no initial code at all. */
export function VerifyForm({ initialCode }: { initialCode?: string } = {}) {
  const [code, setCode] = useState(initialCode ?? '');
  const [res, setRes] = useState<LookupCodeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const announce = useAnnounce();

  async function check(v: string) {
    setCode(v.toUpperCase());
    if (v.trim().length < 4) { setRes(null); return; }
    setBusy(true);
    const r = await lookupCode(v);
    setRes(r);
    setBusy(false);
    if (r.kind === 'certificate') {
      announce(r.result.found ? `${r.result.status}. ${r.result.claimType} issued by ${r.result.issuer}` : 'No certificate with that code', 'assertive');
    } else if (r.kind === 'receipt') {
      const found = r.result;
      if (!found.found) announce('No receipt with that code', 'assertive');
      else if (found.refundedKes >= found.totalKes && found.totalKes > 0) announce(`Receipt from ${found.storeName}, fully refunded`, 'assertive');
      else if (found.refundedKes > 0) announce(`Receipt from ${found.storeName}, total ${kes(found.totalKes)}, partly refunded`, 'assertive');
      else announce(`Receipt from ${found.storeName}, total ${kes(found.totalKes)}`, 'assertive');
    } else {
      announce(`That code is ${r.referenceLabel}, which this page does not verify`, 'assertive');
    }
  }

  useEffect(() => {
    if (initialCode) check(initialCode);
    // Only ever runs once, for the code the link arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cert = res?.kind === 'certificate' ? res.result : null;
  const receipt = res?.kind === 'receipt' ? res.result : null;
  const otherRef = res?.kind === 'other-reference' ? res.referenceLabel : null;

  const tone = cert?.found
    ? { valid: 'var(--green)', expiring: 'var(--amber)', expired: 'var(--red)', revoked: '#5A2A2A' }[cert.status]
    : 'var(--red)';

  /* A refund must never render as a clean green tick. "This receipt is
     real" and "this money is still with the shop" are different claims,
     and a refunded sale answers the first yes and the second no. A
     receipt is a durable public URL, so it is read long after the
     money moved — by the person who paid, disputing the charge, or
     checking whether a return was ever processed. */
  const refunded = receipt?.found ? receipt.refundedKes > 0 : false;
  const fullyRefunded = refunded && receipt!.refundedKes >= receipt!.totalKes && receipt!.totalKes > 0;
  const receiptTone = fullyRefunded ? 'var(--red)' : refunded ? 'var(--amber)' : 'var(--green)';
  const receiptBadge = fullyRefunded ? 'Refunded in full' : refunded ? 'Partly refunded' : 'Receipt';
  const receiptIcon = fullyRefunded ? 'alert-circle' : refunded ? 'clock' : 'check-circle';

  return (
    <>
      <div className="fin-in" style={{ marginBottom: 16 }}>
        <span className="mg"><Icon name="qr" size={22} /></span>
        <input
          value={code} maxLength={16} autoComplete="off"
          aria-label="Certificate or receipt code" aria-describedby="verify-result"
          onChange={(e) => check(e.target.value)}
          placeholder="RC2609298KX3FQ"
          style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textAlign: 'center', textTransform: 'uppercase', fontSize: '1.3rem', padding: '22px 24px 22px 58px' }}
        />
      </div>

      <div id="verify-result" aria-live="polite">
        {busy && <p className="sub" style={{ textAlign: 'center' }}>Checking…</p>}

        {!busy && cert?.found && (
          <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--sh-m)' }}>
            <div style={{ background: tone, color: '#fff', padding: '22px 26px', display: 'flex', gap: 16, alignItems: 'center' }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,.22)', display: 'grid', placeItems: 'center' }}>
                <Icon name={cert.status === 'valid' ? 'check-circle' : cert.status === 'expiring' ? 'clock' : cert.status === 'revoked' ? 'ban' : 'alert-circle'} size={26} />
              </span>
              <div>
                <div className="mono" style={{ fontSize: '.7rem', letterSpacing: '.18em', textTransform: 'uppercase', opacity: .9 }}>
                  {{ valid: 'Valid', expiring: 'Valid — expiring soon', expired: 'Expired', revoked: 'Revoked by issuer' }[cert.status]}
                </div>
                <h2 style={{ color: '#fff', fontSize: '1.35rem', marginTop: 2 }}>{cert.claimType}</h2>
              </div>
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '9px 16px', padding: '24px 26px', margin: 0, fontSize: '.93rem' }}>
              <dt style={{ color: 'var(--tx-2)' }}>Holder</dt><dd style={{ margin: 0, fontWeight: 600 }}>{cert.holder}</dd>
              <dt style={{ color: 'var(--tx-2)' }}>Issued by</dt><dd style={{ margin: 0, fontWeight: 600 }}>{cert.issuer}</dd>
              <dt style={{ color: 'var(--tx-2)' }}>Issued on</dt><dd style={{ margin: 0, fontWeight: 600 }}>{cert.issuedOn}</dd>
              <dt style={{ color: 'var(--tx-2)' }}>Valid until</dt><dd style={{ margin: 0, fontWeight: 600 }}>{cert.validUntil ?? 'No expiry'}</dd>
            </dl>
          </div>
        )}

        {!busy && receipt?.found && (
          <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--sh-m)' }}>
            <div style={{ background: receiptTone, color: '#fff', padding: '22px 26px', display: 'flex', gap: 16, alignItems: 'center' }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,.22)', display: 'grid', placeItems: 'center' }}>
                <Icon name={receiptIcon} size={26} />
              </span>
              <div>
                <div className="mono" style={{ fontSize: '.7rem', letterSpacing: '.18em', textTransform: 'uppercase', opacity: .9 }}>{receiptBadge}</div>
                <h2 style={{ color: '#fff', fontSize: '1.35rem', marginTop: 2 }}>{receipt.storeName}</h2>
              </div>
            </div>
            {/* receiptNo, not the receiptCode this page was keyed on: the
                sequential fiscal label is what a merchant's customer
                actually quotes back, and the only part of this that
                appears on the printed slip too. */}
            <div style={{ padding: '20px 26px 6px', fontSize: '.85rem', color: 'var(--tx-2)' }}>
              {receipt.issuedOn} · <span className="mono">{receipt.receiptNo}</span>
            </div>
            {receipt.itemsPending ? (
              <p className="sub" style={{ padding: '0 26px 20px' }}>Itemisation pending — the merchant hasn't added what this was for yet.</p>
            ) : (
              <div style={{ padding: '0 26px 4px' }}>
                {receipt.items.map((i, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.9rem', padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
                    <span>{i.name} ×{i.quantity}</span>
                    <span>{kes(i.unitPriceKes * i.quantity)}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '.98rem', padding: `16px 26px ${refunded ? 6 : 22}px` }}>
              <span>Total</span><span>{kes(receipt.totalKes)}</span>
            </div>
            {refunded && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.93rem', padding: '6px 26px', color: 'var(--tx-2)' }}>
                  <span>Refunded</span><span>−{kes(receipt.refundedKes)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '.98rem', padding: '6px 26px 22px', color: receiptTone }}>
                  <span>{fullyRefunded ? 'Reimbursed' : 'Still owed'}</span>
                  <span>{kes(Math.max(0, receipt.totalKes - receipt.refundedKes))}</span>
                </div>
              </>
            )}
            {refunded && !fullyRefunded && !receipt.itemsPending && (
              <p className="sub" style={{ padding: '0 26px 18px' }}>
                Part of this purchase was returned. Contact the shop about the difference.
              </p>
            )}
          </div>
        )}

        {!busy && otherRef && (
          <div className="note" style={{ display: 'block', textAlign: 'center', padding: 26 }}>
            <h2 style={{ marginBottom: 8, fontSize: '1.1rem' }}>That&rsquo;s {otherRef}</h2>
            <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>
              This page checks receipts and certificates. It doesn&rsquo;t confirm {otherRef} &mdash;
              that reference is quoted in your app and on your statement.
            </p>
          </div>
        )}

        {!busy && res && res.kind !== 'other-reference' && !res.result.found && (
          <div className="note n-red" style={{ display: 'block', textAlign: 'center', padding: 26 }}>
            <h2 style={{ color: '#96201F', marginBottom: 8, fontSize: '1.1rem' }}>
              {res.kind === 'receipt' ? 'No receipt with that code' : 'No certificate with that code'}
            </h2>
            <p style={{ margin: 0, color: '#7A2320', fontSize: '.93rem' }}>
              Check each character and try again. If the code is correct as printed, this
              {res.kind === 'receipt' ? ' receipt' : ' certificate'} was not issued through Esoqo.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
