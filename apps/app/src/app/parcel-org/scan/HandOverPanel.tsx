'use client';

import { useState, useTransition } from 'react';
import { CodeInput, Icon } from '@esoqo/ui';
import type { OrgParcelRow } from '@/lib/parcel-org-session';
import { handOverParcel, sendReceiverOtp } from './actions';

/** Matches dbx.DeliveryCodeDigits. The boxes on screen have to be the
 *  length the server actually issues, or a clerk fills every box and
 *  the field still isn't complete. */
const CODE_DIGITS = 6;

/**
 * The last screen in a parcel's life: proving the right person is
 * taking it, and recording that they did.
 *
 * Three routes to the same confidence, offered in the order they are
 * usually needed rather than all at once:
 *
 *  1. The six digits from the receiver's SMS. The normal case, and the
 *     only one on screen to begin with.
 *  2. A fresh one-time code to the number ON THE PARCEL — for when the
 *     delivery SMS never arrived, or the six digits have been mistyped
 *     into a lockout. Never a number this screen supplies; core-go
 *     sends it to the parcel's own receiverMsisdn.
 *  3. A hand-over with no code at all, which demands a photo and the
 *     name of whoever signed. Only for staff holding parcels.override,
 *     and deliberately the least convenient of the three — it is the
 *     route that leaves evidence instead of proof.
 *
 * "Who is taking it" is asked every time, on every route. It is the
 * single most useful line in a lost-parcel dispute and the one the
 * code-only flow threw away: a delivery code proves somebody KNEW a
 * code; it never proved who physically took the box.
 */
export function HandOverPanel({
  parcel, canOverride, onCancel, onDone,
}: {
  parcel: OrgParcelRow;
  canOverride: boolean;
  onCancel: () => void;
  onDone: (detail: string) => void;
}) {
  const [code, setCode] = useState('');
  const [otp, setOtp] = useState('');
  const [receivedBy, setReceivedBy] = useState(parcel.receiverName ?? '');
  const [cod, setCod] = useState('');
  const [needsCod, setNeedsCod] = useState(false);
  const [route, setRoute] = useState<'code' | 'otp' | 'override'>('code');
  const [otpSent, setOtpSent] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const named = receivedBy.trim() !== '';
  /** `typed` lets the auto-submit path state the code it just completed.
   *
   *  CodeInput fires onComplete from inside the same handler that calls
   *  onChange, so React has not re-rendered yet and `code` in this
   *  closure is still one digit short. Reading state there made the
   *  final digit silently do nothing — the clerk filled every box and
   *  no request was ever sent. The completed value travels as an
   *  argument instead of being read back out of state. */
  const isReady = (typed?: string) =>
    named &&
    (route === 'code' ? (typed ?? code).length === CODE_DIGITS
      : route === 'otp' ? (typed ?? otp).length === CODE_DIGITS
      : true) &&
    (!needsCod || Number(cod) >= 0);
  const ready = isReady();

  function submit(typed?: string) {
    if (!isReady(typed) || pending) return;
    setError(null);
    start(async () => {
      const res = await handOverParcel({
        code: parcel.code,
        deliveryCode: route === 'code' ? (typed ?? code) : undefined,
        otpCode: route === 'otp' ? (typed ?? otp) : undefined,
        receivedByName: receivedBy,
        codCollectedKes: needsCod ? Number(cod) : undefined,
      });
      if (res.ok) {
        onDone(`${receivedBy.trim()} took it. The sender has been texted.`);
        return;
      }
      // Cash-on-delivery is discovered here rather than predicted: the
      // register's row doesn't carry it, and one reveal on the rare COD
      // parcel beats an extra lookup on every single hand-over.
      if (res.errorCode === 'COD_REQUIRED') {
        setNeedsCod(true);
        setError('This one is paid on delivery. Enter what the receiver handed you.');
        return;
      }
      if (res.errorCode === 'CODE_LOCKED') {
        setLocked(true);
        setRoute('otp');
        setCode('');
        setError(res.error);
        return;
      }
      setError(res.error);
      if (res.errorCode === 'WRONG_CODE') setCode('');
    });
  }

  return (
    <section className="scan-panel info handover" aria-label="Hand over">
      <header className="scan-panel-head">
        <span className="scan-panel-ic" aria-hidden="true"><Icon name="handshake" size={22} /></span>
        <div>
          <h2>Hand it to the receiver</h2>
          <p className="mono scan-panel-code">{parcel.code}</p>
        </div>
      </header>

      <div className="scan-panel-body">
        <dl className="scan-facts">
          <div>
            <dt>Expecting</dt>
            <dd>{parcel.receiverName} <span className="mono">{parcel.receiverMsisdn}</span></dd>
          </div>
        </dl>

        {route === 'code' && (
          <>
            <CodeInput
              id="delivery-code"
              length={CODE_DIGITS}
              value={code}
              onChange={(v) => { setCode(v); setError(null); }}
              onComplete={(typed) => submit(typed)}
              label={`The ${CODE_DIGITS} numbers the receiver got by text`}
              invalid={Boolean(error)}
              disabled={pending}
              /* The clerk has already chosen "hand it over" to reach
                 this panel; the code field is the only thing on it.
                 Focusing it saves a tap per parcel at a counter. */
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            <p className="hint">
              Ask them to read it off their phone. Numbers only — no letters.
            </p>
          </>
        )}

        {route === 'otp' && (
          <>
            {!otpSent ? (
              <div className="handover-otp-start">
                <p>
                  Esoqo will text a fresh code to <span className="mono">{parcel.receiverMsisdn}</span> —
                  the number on the parcel, not one you type in.
                </p>
                <button
                  type="button" className="btn btn-p" disabled={pending}
                  onClick={() => start(async () => {
                    const res = await sendReceiverOtp(parcel.code);
                    if (!res.ok) { setError(res.error); return; }
                    setOtpSent(true);
                    setError(null);
                  })}
                >
                  <Icon name="message" size={16} />Send the code
                </button>
              </div>
            ) : (
              <CodeInput
                id="otp-code"
                length={CODE_DIGITS}
                value={otp}
                onChange={(v) => { setOtp(v); setError(null); }}
                onComplete={(typed) => submit(typed)}
                label="The code just sent to their phone"
                invalid={Boolean(error)}
                disabled={pending}
                /* Same reasoning as the delivery-code field above: the
                   clerk just pressed "send the code" and is waiting to
                   type it. */
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            )}
          </>
        )}

        {route === 'override' && (
          <div className="note n-amber">
            <Icon name="alert-triangle" size={18} />
            <p>
              <strong>No code, so this needs a record.</strong> Write down exactly who took it,
              and take a photo of them holding the box. This is checked if the parcel is ever
              disputed.
            </p>
          </div>
        )}

        {/* Always asked, on every route. */}
        <label className="fld handover-who">
          <span className="lab">
            <Icon name="user" size={15} />Who is taking it?
          </span>
          <input
            className="inp" value={receivedBy}
            onChange={(e) => setReceivedBy(e.target.value)}
            placeholder="Their name"
            disabled={pending}
          />
          <span className="hint">
            If it is not {parcel.receiverName}{' '}— a watchman, a shopkeeper, a relative — write
            that person&rsquo;s name instead.
          </span>
        </label>

        {needsCod && (
          <label className="fld">
            <span className="lab"><Icon name="coins" size={15} />Cash taken on delivery</span>
            <div className="scan-settle-row">
              <span className="scan-settle-cur">KES</span>
              <input
                className="inp mono" value={cod} inputMode="decimal"
                onChange={(e) => setCod(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0" disabled={pending}
              />
            </div>
          </label>
        )}

        {error && (
          <p className="err handover-err" role="alert">
            <Icon name="alert-circle" size={15} />{error}
          </p>
        )}

        <div className="scan-actions">
          <button
            type="button" className="btn btn-p btn-lg" disabled={!ready || pending}
            onClick={() => submit()}
          >
            <Icon name="check" size={17} />
            {pending ? 'Completing…' : 'Complete the hand-over'}
          </button>
          <button type="button" className="btn btn-o" onClick={onCancel} disabled={pending}>
            Back
          </button>
        </div>

        {/* The escape hatches, below the main action and never instead
            of it. Hidden while the normal route is still untried, so
            the first thing a clerk sees is the one that applies. */}
        <div className="handover-alt">
          {route !== 'otp' && (
            <button type="button" className="linkbtn" onClick={() => { setRoute('otp'); setError(null); }}>
              <Icon name="message" size={14} />
              {locked ? 'Send them a one-time code instead' : "They didn't get the text — send a code"}
            </button>
          )}
          {route !== 'code' && !locked && (
            <button type="button" className="linkbtn" onClick={() => { setRoute('code'); setError(null); }}>
              <Icon name="keypad" size={14} />Back to their delivery code
            </button>
          )}
          {canOverride && route !== 'override' && (
            <button type="button" className="linkbtn" onClick={() => { setRoute('override'); setError(null); }}>
              <Icon name="shield" size={14} />No code at all — record who took it
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
