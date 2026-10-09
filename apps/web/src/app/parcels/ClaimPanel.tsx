'use client';

import { useState } from 'react';
import { displayKES } from '@esoqo/domain';
import { Icon } from '@esoqo/ui';
import {
  actionRequestParcelClaimOtp, actionVerifyParcelClaim, type ParcelPartyView,
} from './actions';

/**
 * "This is my parcel" — the way past the guest-safe view.
 *
 * Everything above this on the tracking page is deliberately anonymous,
 * because the code that got you there is printed on the outside of a
 * box and has passed through a courier, a matatu conductor and whoever
 * else handled it. The person it actually belongs to needs more than
 * that: the receiver needs an address and what they owe, the sender
 * needs proof it arrived.
 *
 * The proof asked for is possession of the phone, not of the code. We
 * text the number already on the parcel — never one typed here — so a
 * stranger who reads the sticker and guesses a number gets nothing, and
 * learns nothing from having guessed.
 */
export function ClaimPanel({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [msisdn, setMsisdn] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parcel, setParcel] = useState<ParcelPartyView | null>(null);

  if (parcel) return <PartyView parcel={parcel} />;

  if (!open) {
    return (
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <button className="btn btn-o btn-sm" onClick={() => setOpen(true)}>
          <Icon name="lock" size={13} />This is my parcel
        </button>
        <p className="sub" style={{ margin: '6px 0 0', fontSize: '.82rem' }}>
          Senders and receivers can see more — we&apos;ll text a code to the number already on
          the parcel.
        </p>
      </div>
    );
  }

  function request() {
    if (!msisdn.trim()) { setError('Enter your phone number.'); return; }
    setError(null);
    setBusy(true);
    void actionRequestParcelClaimOtp(code, msisdn).then((res) => {
      setBusy(false);
      if (!res.ok) { setError(res.error); return; }
      setSent(true);
      setHint(res.hint);
    });
  }

  function verify() {
    if (!otp.trim()) { setError('Enter the code we texted you.'); return; }
    setError(null);
    setBusy(true);
    void actionVerifyParcelClaim(code, msisdn, otp).then((res) => {
      setBusy(false);
      if (!res.ok) { setError(res.error); return; }
      setParcel(res.parcel);
    });
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>This is my parcel</strong>
      {!sent ? (
        <>
          <label className="sub" style={{ display: 'block', marginBottom: 8 }}>
            Your phone number
            <input value={msisdn} onChange={(e) => { setMsisdn(e.target.value); setError(null); }}
              placeholder="07…" inputMode="tel" style={INPUT} />
          </label>
          <button className="btn btn-p btn-sm" disabled={busy} onClick={request}>
            {busy ? 'Sending…' : 'Send me a code'}
          </button>
          <p className="sub" style={{ margin: '8px 0 0', fontSize: '.8rem' }}>
            It has to be the number the parcel was sent from or to. We text that number, not
            the one typed here.
          </p>
        </>
      ) : (
        <>
          {/* Says nothing about whether the number matched — see
              actionRequestParcelClaimOtp. */}
          <p className="sub" style={{ margin: '0 0 8px' }}>{hint}</p>
          <label className="sub" style={{ display: 'block', marginBottom: 8 }}>
            Code
            <input value={otp} onChange={(e) => { setOtp(e.target.value); setError(null); }}
              inputMode="numeric" autoComplete="one-time-code" className="mono" style={INPUT} />
          </label>
          <button className="btn btn-p btn-sm" disabled={busy} onClick={verify}>
            {busy ? 'Checking…' : 'Show my parcel'}
          </button>
        </>
      )}
      {error && <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}

/** What the verified party gets that a stranger does not. Sender and
 *  receiver see different halves — a sender wants proof and what they
 *  paid, a receiver wants where to go and what to bring. */
function PartyView({ parcel }: { parcel: ParcelPartyView }) {
  const isReceiver = parcel.tier === 'RECEIVER';
  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <div className="chain" style={{ marginBottom: 12 }}>
        <Icon name="shield-check" size={16} />
        <span>Verified as the {isReceiver ? 'receiver' : 'sender'}.</span>
      </div>

      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px' }}>
        <Term label={isReceiver ? 'From' : 'To'}>
          {parcel.counterpartyName}
          {parcel.counterpartyPhoneLast4 && (
            <span className="sub"> · ••••{parcel.counterpartyPhoneLast4}</span>
          )}
        </Term>

        {isReceiver ? (
          <>
            {parcel.codDueKes && Number(parcel.codDueKes) > 0 && (
              <Term label="You pay on arrival">KES {displayKES(parcel.codDueKes)}</Term>
            )}
            {/* The receiver's half of proving the parcel reached the
                right person. Never shown to the sender — knowing it
                would let them authorise their own delivery. */}
            {parcel.deliveryCode && (
              <Term label="Show the courier">
                <span className="mono" style={{ fontWeight: 700, letterSpacing: '.08em' }}>
                  {parcel.deliveryCode}
                </span>
              </Term>
            )}
          </>
        ) : (
          <>
            {parcel.priceKesOwn && (
              <Term label={parcel.paid === false ? 'Fare' : 'You paid'}>KES {displayKES(parcel.priceKesOwn)}</Term>
            )}
            {parcel.paymentMethod && (
              <Term label="Payment">{senderPaymentLabel(parcel.paymentMethod, parcel.paid, parcel.mpesaReceiptCode)}</Term>
            )}
            {parcel.refundStatus && parcel.refundStatus !== 'NONE' && (
              <Term label="Refund">{parcel.refundStatus.toLowerCase()}</Term>
            )}
          </>
        )}
      </dl>
    </div>
  );
}

/** PAY_AT_COUNTER is chosen at booking, so on its own it doesn't mean
 *  paid — `paid` does; a receipt means M-Pesa (STK) rather than cash. */
function senderPaymentLabel(method: string, paid: boolean | undefined, receipt: string | null | undefined): string {
  if (paid === false) return method === 'PAY_AT_COUNTER' ? 'Pay at the counter (not paid yet)' : 'Not paid yet';
  if (receipt) return `M-Pesa (${receipt})`;
  if (method === 'PAY_AT_COUNTER' || method === 'CASH') return 'Cash at the counter';
  if (method === 'ESOKO_POINTS') return 'Esoqo points';
  return method === 'MPESA_STK' ? 'M-Pesa' : method.replace(/_/g, ' ').toLowerCase();
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="sub" style={{ fontSize: '.82rem' }}>{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </>
  );
}

const INPUT: React.CSSProperties = {
  display: 'block', width: '100%', maxWidth: 260, padding: '8px 10px',
  border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 3,
};
