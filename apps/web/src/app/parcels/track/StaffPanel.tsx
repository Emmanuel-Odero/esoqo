'use client';

import { Suspense, useEffect, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import {
  staffRequestOtp, staffVerifyOtp, staffSignOut, getStaffMe, getStaffActivity, staffScanCustody,
  staffDeliverParcel, staffRequestDeliveryOtp, lookupEsoqoId,
  type StaffMe, type PartyParcelActivityRow,
} from './staff-actions';
import { ParcelScanner } from './ParcelScanner';
import { actionCheckParcelStatus, type AwaitingIntakeView, type ParcelStatusView } from '../actions';

const ROLE_LABEL: Record<PartyParcelActivityRow['role'], string> = {
  SENT: 'You sent',
  RECEIVING: 'Coming to you',
  HOLDING: 'In your custody',
};

/**
 * Two independent things live on this one collapsed section, and they
 * are not the same feature:
 *
 * 1. An Esoqo ID lookup — public, PII-minimal, no session (see
 *    lookupEsoqoId). Anyone reading this page can use it.
 * 2. A signed-in staff panel — parcels you've touched, and a scan tool
 *    to act on the one in your hand. A code typed in never unlocks
 *    this on its own; only an OTP sent to your own registered number
 *    does (see staff-actions.ts's own comment on why this surface uses
 *    OTP rather than the dedicated company portal's name+PIN).
 *
 * Named "Authorized search" rather than "Staff sign-in" deliberately —
 * a button that announces "staff tools live here" on a page anyone can
 * reach is itself a target; the toggle still does the same thing, it
 * just doesn't advertise what for.
 */
export function StaffPanel() {
  // useSearchParams needs its own Suspense boundary during static
  // rendering — everything that actually reads it lives in
  // StaffPanelInner so the rest of this (mostly static) page isn't
  // forced client-side just to check for an invite link's query params.
  return (
    <Suspense fallback={null}>
      <StaffPanelInner />
    </Suspense>
  );
}

function StaffPanelInner() {
  // An admin invite link (see notify.ParcelStaffInviteURL in
  // services/core-go) pre-fills company + name and opens this panel
  // straight to "Send code" — it never fires the OTP request itself,
  // so a chat app prefetching the link for a preview can't spend
  // someone's invite code before they ever see it.
  const searchParams = useSearchParams();
  const inviteOrgSlug = searchParams.get('orgSlug') ?? '';
  const inviteName = searchParams.get('name') ?? '';
  const [open, setOpen] = useState(Boolean(inviteOrgSlug || inviteName));
  const [me, setMe] = useState<StaffMe | null | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open && me === undefined) {
      void getStaffMe().then(setMe);
    }
  }, [open, me]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <button type="button" className="btn btn-o btn-sm" onClick={() => setOpen((v) => !v)}>
        <Icon name="lock" size={13} />{open ? 'Close' : 'Authorized search'}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <EsoqoIdLookup />
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 14 }}>
            {me === undefined ? (
              <p className="sub">Checking…</p>
            ) : me ? (
              <SignedInPanel me={me} onSignedOut={() => setMe(null)} />
            ) : (
              <OtpSignInForm
                initialOrgSlug={inviteOrgSlug} initialName={inviteName}
                onSignedIn={() => { setMe(undefined); startTransition(() => { void getStaffMe().then(setMe); }); }} pending={pending} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EsoqoIdLookup() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ esoqoId: string; displayName: string; organisation: string | null } | null | undefined>(undefined);
  const [pending, start] = useTransition();

  function lookup() {
    if (!code.trim()) return;
    start(async () => setResult(await lookupEsoqoId(code.trim())));
  }

  return (
    <div>
      <label className="sub" htmlFor="esoqo-id" style={{ display: 'block', marginBottom: 6 }}>
        Look up an Esoqo ID
      </label>
      <div className="row" style={{ gap: 8 }}>
        <input id="esoqo-id" className="mono" value={code}
          placeholder="ESK-XXXX-KE" onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
          style={{ flex: 1, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
        <button className="btn btn-o btn-sm" disabled={pending || !code.trim()} onClick={lookup}>
          {pending ? 'Looking…' : 'Look up'}
        </button>
      </div>
      {result === null && <p className="sub" style={{ margin: '6px 0 0' }}>No Esoqo ID matches that.</p>}
      {result && (
        <p className="sub" style={{ margin: '6px 0 0' }}>
          <strong>{result.displayName}</strong>{result.organisation ? ` — ${result.organisation}` : ''}
        </p>
      )}
    </div>
  );
}

/** Two steps, one form: request a code, then the same fields plus the
 *  code itself. Re-sending is just clicking "Request a code" again —
 *  no separate resend affordance needed for a flow this short. */
function OtpSignInForm({
  initialOrgSlug = '', initialName = '', onSignedIn, pending,
}: { initialOrgSlug?: string; initialName?: string; onSignedIn: (expiresAt?: number) => void; pending: boolean }) {
  const [orgSlug, setOrgSlug] = useState(initialOrgSlug);
  const [name, setName] = useState(initialName);
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, start] = useTransition();

  function requestCode() {
    setError(null);
    start(async () => {
      await staffRequestOtp(orgSlug, name);
      setOtpRequested(true);
    });
  }

  function verify() {
    setError(null);
    start(async () => {
      const res = await staffVerifyOtp(orgSlug, name, otpCode);
      if (!res.ok) { setError(res.error); return; }
      onSignedIn(res.expiresAt);
    });
  }

  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
      <p className="sub" style={{ margin: 0 }}>
        {otpRequested
          ? "If that name's on file, we've texted a code to their registered number."
          : 'Enter your company and name — we text a one-time code to your registered number.'}
      </p>
      <input value={orgSlug} placeholder="Company (e.g. dreamline)" disabled={otpRequested}
        onChange={(e) => setOrgSlug(e.target.value)}
        style={{ padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
      <input value={name} placeholder="Your name" disabled={otpRequested}
        onChange={(e) => setName(e.target.value)}
        style={{ padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
      {!otpRequested ? (
        <button className="btn btn-p btn-sm" disabled={submitting || pending || !orgSlug.trim() || !name.trim()} onClick={requestCode}>
          {submitting || pending ? 'Sending…' : 'Request a code'}
        </button>
      ) : (
        <>
          <input value={otpCode} inputMode="numeric" placeholder="One-time code"
            onChange={(e) => setOtpCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && otpCode.trim() && verify()}
            style={{ padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-p btn-sm" disabled={submitting || pending || !otpCode.trim()} onClick={verify}>
              {submitting || pending ? 'Verifying…' : 'Verify'}
            </button>
            <button className="btn btn-o btn-sm" disabled={submitting} onClick={() => { setOtpRequested(false); setOtpCode(''); }}>
              Start over
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" style={{ color: 'var(--red)', margin: 0, fontSize: '.85rem' }}>{error}</p>}
    </div>
  );
}

/** A live "signed in for another Xh Ym" readout, ticking down from the
 *  session's own expiresAt rather than a client-side guess — the same
 *  fact the server enforces, just rendered. Reads "Session expired" at
 *  zero instead of a negative number; the next authenticated call
 *  naturally 401s and bounces back to the sign-in form regardless. */
function SessionCountdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!expiresAt) return null;
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return <span className="sub" style={{ color: 'var(--red)' }}>Session expired</span>;
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  return <span className="sub">Signed in for {hours}h {minutes}m</span>;
}

function SignedInPanel({ me, onSignedOut }: { me: StaffMe; onSignedOut: () => void }) {
  const [activity, setActivity] = useState<PartyParcelActivityRow[] | null>(null);
  const canScan = me.capabilities.includes('parcelorg.carry');

  useEffect(() => { void getStaffActivity().then(setActivity); }, []);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <strong>{me.org.name}</strong>
        <button className="btn btn-o btn-sm" onClick={() => { void staffSignOut().then(onSignedOut); }}>
          Log out
        </button>
      </div>
      <div style={{ marginBottom: 10 }}>
        <SessionCountdown expiresAt={me.expiresAt} />
      </div>

      <p className="sub" style={{ margin: '0 0 6px' }}>Your parcels</p>
      {activity === null ? (
        <p className="sub">Loading…</p>
      ) : activity.length === 0 ? (
        <p className="sub">Nothing yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0 0 14px', padding: 0, display: 'grid', gap: 4 }}>
          {activity.map((p) => (
            <li key={`${p.code}-${p.role}`} className="sub" style={{ fontSize: '.85rem' }}>
              <span className="mono">{p.code}</span> — {ROLE_LABEL[p.role]} · {p.destinationLabel}
            </li>
          ))}
        </ul>
      )}

      {canScan && <ScanPanel />}
    </div>
  );
}

function ScanPanel() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<ParcelStatusView | AwaitingIntakeView | null>(null);
  const [deliveryCode, setDeliveryCode] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function lookup(scanned: string) {
    const value = scanned.trim().toUpperCase();
    if (!value) return;
    setCode(value);
    setMessage(null);
    setError(null);
    setOtpSent(null);
    start(async () => refreshStatus(value));
  }

  function refreshStatus(value: string) {
    start(async () => {
      const res = await actionCheckParcelStatus(value);
      if (res.kind === 'found') {
        setStatus(res.parcel);
        setError(null);
      } else if (res.kind === 'not-found') {
        setStatus(null);
        setError("That code wasn't found — check it and try again.");
      } else {
        setStatus(null);
        setError(res.error);
      }
    });
  }

  function doHandoff() {
    setError(null);
    start(async () => {
      const res = await staffScanCustody(code);
      if (!res.ok) { setError(res.error); return; }
      setMessage('Custody recorded.');
      refreshStatus(code);
    });
  }

  function sendReceiverOtp() {
    setError(null);
    start(async () => {
      const res = await staffRequestDeliveryOtp(code);
      if (!res.ok) { setError(res.error); return; }
      setOtpSent(res.maskedMsisdn);
    });
  }

  function doDeliver() {
    if (!deliveryCode.trim() && !otpCode.trim()) {
      setError('Enter the delivery code, or the one-time code the receiver just read out.');
      return;
    }
    setError(null);
    start(async () => {
      const res = await staffDeliverParcel(code, deliveryCode.trim(), otpCode.trim());
      if (!res.ok) { setError(res.error); return; }
      setMessage('Checked out — delivered.');
      setDeliveryCode('');
      setOtpCode('');
      setOtpSent(null);
      refreshStatus(code);
    });
  }

  // One button, contextually labelled and wired — not four, since
  // "check in", "dispatch" and "arrived at a destination hub" are all
  // the same custody handoff underneath (see staffScanCustody's own
  // comment). Only DELIVERED and terminal states get no action at all.
  const handoffLabel: Record<string, string> = {
    BOOKED: 'Check in (received)',
    RECEIVED_AT_COUNTER: 'Dispatch to next leg',
    PICKED_UP: 'Dispatch to next leg',
    IN_TRANSIT: 'Check in at this stop',
    FAILED_DELIVERY: 'Check in at this stop',
    HELD_AT_AGENT: 'Check in at this stop',
  };

  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <p className="sub" style={{ margin: '0 0 6px' }}>Scan a parcel</p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <input className="mono" value={code} placeholder="PKG-XXXXXX or TCK-XXXXXX"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && lookup(code)}
          style={{ flex: 1, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
        <button className="btn btn-o btn-sm" disabled={!code.trim()} onClick={() => lookup(code)}>Look up</button>
      </div>
      <ParcelScanner onScan={lookup} />

      {status && 'message' in status && (
        // AWAITING_INTAKE — looked up by the service ticket number a
        // walk-in sender shows at the counter (see core-go's
        // Parcel.serviceTicketNumber schema comment): there's no route
        // or status to show yet, but doHandoff still works on whatever
        // was typed above — ScanHandoff itself resolves a ticket number
        // to the real parcel, so "Check in" is exactly the same action
        // as it is for a real code below.
        <div style={{ marginTop: 10 }}>
          <p className="sub" style={{ margin: '0 0 8px' }}>{status.message}</p>
          <button className="btn btn-p btn-sm" disabled={pending} onClick={doHandoff}>
            {pending ? 'Working…' : 'Check in (received)'}
          </button>
        </div>
      )}

      {status && !('message' in status) && (
        <div style={{ marginTop: 10 }}>
          <p className="sub" style={{ margin: '0 0 8px' }}>
            {status.status} — {status.originLabel} → {status.destinationLabel}
          </p>
          {handoffLabel[status.status] && (
            <button className="btn btn-p btn-sm" disabled={pending} onClick={doHandoff}>
              {pending ? 'Working…' : handoffLabel[status.status]}
            </button>
          )}
          {(status.status === 'IN_TRANSIT' || status.status === 'HELD_AT_AGENT') && (
            <div style={{ marginTop: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <input className="mono" value={deliveryCode} placeholder="Delivery code"
                  onChange={(e) => { setDeliveryCode(e.target.value); if (e.target.value) setOtpCode(''); }}
                  style={{ flex: 1, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
                <button className="btn btn-o btn-sm" disabled={pending} onClick={doDeliver}>Check out (delivered)</button>
              </div>
              {/* The identity-check alternative: instead of trusting
                  whoever is holding the printed code, text a fresh one
                  to the number already on the parcel and have them read
                  it back. Offered beside the code, not instead of it —
                  a receiver with their code in hand still doesn't need
                  this. */}
              {!otpSent ? (
                <button className="btn btn-o btn-sm" style={{ marginTop: 8 }} disabled={pending} onClick={sendReceiverOtp}>
                  Or send a one-time code to the receiver
                </button>
              ) : (
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <input className="mono" value={otpCode} placeholder={`Code sent to ${otpSent}`} inputMode="numeric"
                    onChange={(e) => { setOtpCode(e.target.value); if (e.target.value) setDeliveryCode(''); }}
                    style={{ flex: 1, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
                  <button className="btn btn-o btn-sm" disabled={pending} onClick={doDeliver}>Confirm identity</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {message && <p className="sub" style={{ margin: '8px 0 0', color: 'var(--green)' }}>{message}</p>}
      {error && <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}
