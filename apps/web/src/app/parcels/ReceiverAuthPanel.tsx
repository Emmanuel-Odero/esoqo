'use client';

import { useState } from 'react';
import { displayKES } from '@esoqo/domain';
import { Icon } from '@esoqo/ui';

import {
  actionVerifyReceiverCode, actionReceiverSelfConfirm,
  type ParcelPartyView, type ReceiverAuthFailure,
} from './actions';

/**
 * "I'm the receiver — I have the code."
 *
 * The companion to ClaimPanel directly beneath it. Both unlock the same
 * receiver-tier view; they differ only in what they ask you to prove.
 * ClaimPanel wants the phone (we text the number already on the parcel)
 * and then hands you your delivery code. This wants the delivery code
 * itself.
 *
 * Two routes because each one's assumption is the other's failure case.
 * A receiver whose SMS never landed — a dead handset, a number that
 * changed, a message eaten by a gateway — cannot use the phone route at
 * all, and that is the common case here, not the exotic one. A receiver
 * whose sender simply read the code down the line has no need of a
 * second text.
 *
 * Three attempts, and the counter lives on the parcel, not in this
 * browser: clearing cookies or switching to a friend's phone buys
 * nothing. Running out is not a dead end — it raises a work item at the
 * carrying company, who can allow two more or issue a new code.
 */

type Phase =
  | { at: 'closed' }
  | { at: 'entry'; error?: ReceiverAuthFailure }
  | { at: 'locked'; hard: boolean; message: string }
  | { at: 'verified'; parcel: ParcelPartyView; token: string; canSelfConfirm: boolean; reason: string }
  | { at: 'collected' };

export function ReceiverAuthPanel({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>({ at: 'closed' });
  const [entered, setEntered] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  function verify() {
    if (!entered.trim()) {
      setPhase({ at: 'entry', error: { ok: false, code: 'OTHER', error: 'Enter your delivery code.' } });
      return;
    }
    setBusy(true);
    void actionVerifyReceiverCode(code, entered).then((res) => {
      setBusy(false);
      if (res.ok) {
        setPhase({
          at: 'verified', parcel: res.parcel, token: res.receiverToken,
          canSelfConfirm: res.canSelfConfirm, reason: res.selfConfirmReason,
        });
        // Not kept in state past this point. The code is the one secret
        // in this flow and there is no reason for it to outlive the
        // request that spent it.
        setEntered('');
        return;
      }
      if (res.code === 'RECEIVER_LOCKED' || res.code === 'RECEIVER_HARD_LOCKED') {
        setPhase({ at: 'locked', hard: res.code === 'RECEIVER_HARD_LOCKED', message: res.error });
        setEntered('');
        return;
      }
      setPhase({ at: 'entry', error: res });
    });
  }

  function confirmCollected(token: string) {
    setBusy(true);
    setConfirmError(null);
    void actionReceiverSelfConfirm(code, token).then((res) => {
      setBusy(false);
      if (!res.ok) { setConfirmError(res.error); return; }
      setPhase({ at: 'collected' });
    });
  }

  if (phase.at === 'collected') {
    return (
      <Shell>
        <div className="chain">
          <Icon name="check-circle" size={16} />
          <span>Marked as collected. Thanks — the sender has been told.</span>
        </div>
      </Shell>
    );
  }

  if (phase.at === 'locked') {
    return (
      <Shell>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Icon name={phase.hard ? 'alert-circle' : 'alert-triangle'} size={18} />
          <div>
            <strong style={{ display: 'block', marginBottom: 4 }}>
              {phase.hard ? 'Locked — a new code is needed' : 'Too many wrong codes'}
            </strong>
            <p className="sub" style={{ margin: 0, fontSize: '.86rem' }}>{phase.message}</p>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase.at === 'verified') {
    return (
      <Shell>
        <div className="chain" style={{ marginBottom: 12 }}>
          <Icon name="shield-check" size={16} />
          <span>Verified as the receiver.</span>
        </div>

        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px' }}>
          <Term label="From">
            {phase.parcel.counterpartyName}
            {phase.parcel.counterpartyPhoneLast4 && (
              <span className="sub"> · ••••{phase.parcel.counterpartyPhoneLast4}</span>
            )}
          </Term>
          {phase.parcel.codDueKes && Number(phase.parcel.codDueKes) > 0 && (
            <Term label="You pay on collection">KES {displayKES(phase.parcel.codDueKes)}</Term>
          )}
        </dl>

        {/* The delivery code is deliberately not echoed back. On the
            phone route showing it is the entire point — you proved the
            number and are being handed the code you never got. Here you
            just typed it, so printing it only leaves a copy on screen. */}

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          {phase.canSelfConfirm ? (
            <>
              <button className="btn btn-p btn-sm" disabled={busy} onClick={() => confirmCollected(phase.token)}>
                {busy ? 'Confirming…' : "I've collected it"}
              </button>
              <p className="sub" style={{ margin: '8px 0 0', fontSize: '.8rem' }}>
                Only tap this once the parcel is actually in your hands.
              </p>
            </>
          ) : (
            <p className="sub" style={{ margin: 0, fontSize: '.86rem' }}>{phase.reason}</p>
          )}
          {confirmError && (
            <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{confirmError}</p>
          )}
        </div>
      </Shell>
    );
  }

  if (phase.at === 'closed') {
    return (
      <Shell>
        <button className="btn btn-o btn-sm" onClick={() => setPhase({ at: 'entry' })}>
          <Icon name="key" size={13} />I&apos;m the receiver
        </button>
        <p className="sub" style={{ margin: '6px 0 0', fontSize: '.82rem' }}>
          Enter the delivery code you were sent to see the full details.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <strong style={{ display: 'block', marginBottom: 8 }}>I&apos;m the receiver</strong>
      <label className="sub" style={{ display: 'block', marginBottom: 8 }}>
        Your delivery code
        <input
          value={entered}
          onChange={(e) => { setEntered(e.target.value); setPhase({ at: 'entry' }); }}
          inputMode="numeric"
          autoComplete="off"
          className="mono"
          placeholder="••••••"
          style={INPUT}
        />
      </label>
      <button className="btn btn-p btn-sm" disabled={busy} onClick={verify}>
        {busy ? 'Checking…' : 'Verify'}
      </button>
      <p className="sub" style={{ margin: '8px 0 0', fontSize: '.8rem' }}>
        Three tries. If you run out, the courier company can allow two more or send a new code.
      </p>
      {phase.error && (
        <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{phase.error.error}</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>{children}</div>;
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
  display: 'block', width: '100%', maxWidth: 200, padding: '8px 10px',
  border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 3,
  letterSpacing: '.18em', fontWeight: 600,
};
