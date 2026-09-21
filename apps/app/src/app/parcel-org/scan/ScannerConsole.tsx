'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { dropPointFor, Icon, PrintStyles, ScaledLabel } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { extractParcelCode } from '@esoqo/domain';
import type { OrgParcelRow, OrgShipment } from '@/lib/parcel-org-session';
import { ScanButton } from '../ScanButton';
import { HandOverPanel } from './HandOverPanel';
import { RunPicker } from './RunPicker';
import { listOpenRuns, receiveParcel, resolveScan, settleAtCounter } from './actions';
import type { ScanTarget } from '../parcel-stages';

/**
 * The scanner's whole behaviour, in one place.
 *
 * Two ideas hold it together.
 *
 * FIRST: the scan box never loses focus. A handheld gun is a keyboard
 * that types fast and presses Enter, so "the box is focused" is the
 * entire hardware integration — and a box that quietly loses focus
 * after an action means the next scan goes nowhere and the clerk
 * doesn't find out until they look up. Focus is restored after every
 * action, on window focus, and on any click that isn't in a field.
 *
 * SECOND: one code in, one set of buttons out. The panel below the box
 * is a function of what was scanned and what state it is in — never a
 * menu of everything the portal can do. A clerk holding a box should
 * read the screen and see the two or three things that are true for
 * THIS box, which is what makes the thing operable by someone who was
 * shown it once.
 */

const STATUS_LABEL: Record<string, string> = {
  DRAFT_PENDING_PAYMENT: 'Not paid yet',
  BOOKED: 'Waiting for a rider',
  RECEIVED_AT_COUNTER: 'At our counter',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'On the way',
  FAILED_DELIVERY: 'Delivery attempted',
  HELD_AT_AGENT: 'At a pickup point',
  DELIVERED: 'Delivered',
  RETURNED_TO_SENDER: 'Returned to sender',
  CANCELLED: 'Cancelled',
};

type Phase =
  | { k: 'idle' }
  | { k: 'busy'; note: string }
  | { k: 'target'; target: ScanTarget }
  /** The moving-parcel fork: only the person holding the box knows
   *  whether this is a stop on the way or the end of the road. */
  | { k: 'handover'; parcel: OrgParcelRow }
  | { k: 'done'; title: string; detail: string; code?: string; tone: 'ok' | 'warn' };

export function ScannerConsole({
  orgName, orgLogoUrl, initialRuns, canCarry, canDispatch, canIntake, canArrival,
  canOverride, custodyCapable,
}: {
  orgName: string;
  orgLogoUrl?: string;
  initialRuns: OrgShipment[];
  canCarry: boolean;
  canDispatch: boolean;
  canIntake: boolean;
  canArrival: boolean;
  canOverride: boolean;
  custodyCapable: boolean;
}) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<OrgShipment[]>(initialRuns);
  const [pending, start] = useTransition();
  const say = useAnnounce();
  const boxRef = useRef<HTMLInputElement>(null);

  const refocus = useCallback(() => {
    // rAF, not a bare call: React may still be committing the panel
    // that replaced the last one, and focusing mid-commit is silently
    // undone.
    requestAnimationFrame(() => boxRef.current?.focus());
  }, []);

  // The gun fires wherever the page happens to be focused, so focus
  // comes home whenever nothing else has deliberately taken it.
  useEffect(() => {
    const onFocus = () => refocus();
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, button, a, [role="dialog"]')) return;
      refocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('click', onClick);
    };
  }, [refocus]);

  function reset() {
    setPhase({ k: 'idle' });
    setError(null);
    setText('');
    refocus();
  }

  function submit(raw: string) {
    const code = (extractParcelCode(raw.trim()) || raw.trim()).toUpperCase();
    if (!code) return;
    setError(null);
    setText('');
    setPhase({ k: 'busy', note: `Looking up ${code}…` });
    start(async () => {
      const [target, freshRuns] = await Promise.all([
        resolveScan(code),
        // Refetched per scan so a lorry that left while the clerk was
        // serving the last customer is gone from the picker rather than
        // failing on submit.
        canCarry || canDispatch ? listOpenRuns() : Promise.resolve(runs),
      ]);
      setRuns(freshRuns);
      setPhase({ k: 'target', target });
      say(describe(target), 'assertive');
      refocus();
    });
  }

  /** Take custody. Shared by every "receive" button on the page. */
  function doReceive(reference: string, then?: (code: string) => void) {
    setError(null);
    setPhase({ k: 'busy', note: 'Taking it into custody…' });
    start(async () => {
      const res = await receiveParcel(reference);
      if (!res.ok) {
        setError(res.error);
        setPhase({ k: 'idle' });
        refocus();
        return;
      }
      if (then) { then(res.code); return; }
      setPhase({
        k: 'done', tone: 'ok', code: res.code,
        title: 'Received — in your custody',
        detail: 'The sender has been texted a receipt. It is waiting for a run.',
      });
      say('Received into custody', 'assertive');
      refocus();
    });
  }

  const busy = pending || phase.k === 'busy';

  return (
    <div className="scan-console">
      {/* ── the box, always ready ── */}
      <div className="scanbar">
        <span className="scanbar-ic" aria-hidden="true"><Icon name="qr" size={22} /></span>
        <form
          className="scanbar-form"
          onSubmit={(e) => { e.preventDefault(); submit(text); }}
        >
          <label className="sr-only" htmlFor="scan-box">
            Scan or type a label, parcel or ticket code
          </label>
          <input
            id="scan-box"
            ref={boxRef}
            className="scanbar-input mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Scan a code, or type it here"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            /* This box IS the page. A scanner gun types into whatever
               holds focus, so not focusing on open means the first scan
               of a shift lands nowhere and the clerk has no way to tell
               why. The rule's usual objection — stealing focus from
               content somebody was reading — does not apply to a
               single-purpose screen whose only content is this field. */
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            disabled={busy}
          />
        </form>
        <ScanButton onScan={(c) => submit(c)} />
      </div>

      {!custodyCapable && (
        <div className="note n-amber scan-note">
          <Icon name="alert-triangle" size={18} />
          <p>
            <strong>This login can receive boxes but cannot hand them over.</strong>
            It isn&rsquo;t linked to a person, and Esoqo records who is holding every parcel.
            Ask a manager to add your phone number to your row on{' '}
            <Link href="/parcel-org/settings/team">the Team page</Link>.
          </p>
        </div>
      )}

      {error && (
        <div className="note n-red scan-note" role="alert">
          <Icon name="alert-circle" size={18} />
          <p>{error}</p>
        </div>
      )}

      {/* ── the verdict ── */}
      {phase.k === 'idle' && (
        <div className="scan-idle">
          <span className="scan-idle-ic" aria-hidden="true"><Icon name="box" size={30} /></span>
          <h2>Ready</h2>
          <p>
            Point the scanner at any Esoqo label, or type the code. {orgName} will show you
            what it is and the only things you can do with it.
          </p>
        </div>
      )}

      {phase.k === 'busy' && (
        <div className="scan-idle" role="status">
          <span className="scan-idle-ic is-busy" aria-hidden="true"><Icon name="loader" size={30} /></span>
          <h2>{phase.note}</h2>
        </div>
      )}

      {phase.k === 'done' && (
        <div className={`scan-done ${phase.tone}`} role="status">
          <span className="scan-done-ic" aria-hidden="true">
            <Icon name={phase.tone === 'ok' ? 'check-circle' : 'alert-triangle'} size={30} />
          </span>
          <h2>{phase.title}</h2>
          {phase.code && <p className="mono scan-done-code">{phase.code}</p>}
          <p>{phase.detail}</p>
          <button type="button" className="btn btn-p" onClick={reset}>
            <Icon name="qr" size={16} />Scan the next one
          </button>
        </div>
      )}

      {phase.k === 'handover' && (
        <HandOverPanel
          parcel={phase.parcel}
          canOverride={canOverride}
          onCancel={() => setPhase({ k: 'target', target: { kind: 'parcel', code: phase.parcel.code, stage: 'moving', parcel: phase.parcel } })}
          onDone={(detail) => {
            setPhase({
              k: 'done', tone: 'ok', code: phase.parcel.code,
              title: 'Handed over', detail,
            });
            say('Handed over', 'assertive');
            refocus();
          }}
        />
      )}

      {phase.k === 'target' && (
        <TargetPanel
          target={phase.target}
          runs={runs}
          canCarry={canCarry}
          canDispatch={canDispatch}
          canIntake={canIntake}
          canArrival={canArrival}
          custodyCapable={custodyCapable}
          busy={busy}
          orgName={orgName}
          orgLogoUrl={orgLogoUrl}
          onReceive={doReceive}
          onHandOver={(parcel) => setPhase({ k: 'handover', parcel })}
          onLoaded={(code, run) => {
            setPhase({
              k: 'done', tone: 'ok', code,
              title: 'On its way',
              detail: `Loaded onto ${run.vehiclePlate || 'the run'} for ${run.destinationLabel}. The receiver has been texted.`,
            });
            refocus();
          }}
          onSettled={(code) => {
            setPhase({
              k: 'done', tone: 'ok', code,
              title: 'Payment recorded',
              detail: 'Now scan it again to take it into custody.',
            });
            refocus();
          }}
          onError={setError}
          onReset={reset}
        />
      )}
    </div>
  );
}

function describe(t: ScanTarget): string {
  switch (t.kind) {
    case 'blank-label': return 'Empty label. Fill in the shipping details.';
    case 'filled-label': return 'Label already written on. Check the details.';
    case 'ticket': return 'Drop-off ticket. Ready to receive.';
    case 'unknown': return t.reason;
    case 'parcel': return `${t.code}: ${STATUS_LABEL[t.parcel.status] ?? t.parcel.status}`;
  }
}

/**
 * One panel per kind, and for a parcel one per stage.
 *
 * A switch with no default that returns for every case, so adding a
 * stage without a panel is a type error rather than a clerk staring at
 * a box with no buttons under it.
 */
function TargetPanel({
  target, runs, canCarry, canDispatch, canIntake, canArrival, custodyCapable,
  busy, orgName, orgLogoUrl, onReceive, onHandOver, onLoaded, onSettled, onError, onReset,
}: {
  target: ScanTarget;
  runs: OrgShipment[];
  canCarry: boolean;
  canDispatch: boolean;
  canIntake: boolean;
  canArrival: boolean;
  custodyCapable: boolean;
  busy: boolean;
  orgName: string;
  orgLogoUrl?: string;
  onReceive: (reference: string, then?: (code: string) => void) => void;
  onHandOver: (parcel: OrgParcelRow) => void;
  onLoaded: (code: string, run: OrgShipment) => void;
  onSettled: (code: string) => void;
  onError: (message: string) => void;
  onReset: () => void;
}) {
  const canReceive = canCarry || canIntake;

  if (target.kind === 'unknown') {
    return (
      <Panel tone="warn" icon="alert-triangle" title="Not one of yours" code={target.code}>
        <p>{target.reason}</p>
        <div className="scan-actions">
          <button type="button" className="btn btn-o" onClick={onReset}>
            <Icon name="qr" size={16} />Scan something else
          </button>
        </div>
      </Panel>
    );
  }

  // A pre-intake service ticket: the sender's only reference before the
  // parcel has a tracking code. Receiving resolves it server-side.
  if (target.kind === 'ticket') {
    return (
      <Panel tone="info" icon="inbox" title="Drop-off ticket" code={target.code}>
        <p>The sender is bringing this in. Take it into custody to give it a tracking code.</p>
        <div className="scan-actions">
          <button
            type="button" className="btn btn-p btn-lg" disabled={busy || !canReceive}
            onClick={() => onReceive(target.code)}
          >
            <Icon name="check" size={17} />Received — in my custody
          </button>
        </div>
        {!canReceive && <p className="hint">Your role can&rsquo;t take custody.</p>}
      </Panel>
    );
  }

  // Both label kinds route to the booking form on the counter — one
  // booking implementation, not two (see the counter page's own note).
  if (target.kind === 'blank-label' || target.kind === 'filled-label') {
    const blank = target.kind === 'blank-label';
    return (
      <Panel
        tone="info"
        icon="tag"
        title={blank ? 'Empty label' : 'Label already written on'}
        code={target.code}
      >
        <ScanLabelPreview
          code={target.code}
          route={blank ? undefined : dropPointFor(target.label.destination)}
          orgName={orgName} orgLogoUrl={orgLogoUrl}
        />
        <p>
          {blank
            ? 'Nothing is written on this sticker yet. Fill in who it is from, who it is for, and where it is going — then receive it.'
            : 'Someone has written on this sticker. Check the details, change anything that is wrong, then receive it.'}
        </p>
        {!blank && <LabelNotes label={target.label} />}
        <div className="scan-actions">
          <Link
            className="btn btn-p btn-lg"
            href={`/parcel-org/counter?code=${encodeURIComponent(target.code)}`}
          >
            <Icon name="document" size={17} />
            {blank ? 'Fill in the shipping details' : 'Check and receive'}
          </Link>
        </div>
        {!canDispatch && (
          <p className="hint">Your role can&rsquo;t create bookings — pass this to a colleague who can.</p>
        )}
      </Panel>
    );
  }

  const { parcel, stage } = target;
  const head = (
    <>
      <ScanLabelPreview
        code={parcel.code} route={dropPointFor(parcel.destinationLabel)}
        orgName={orgName} orgLogoUrl={orgLogoUrl}
      />
      <ParcelSummary parcel={parcel} />
    </>
  );

  switch (stage) {
    case 'unpaid':
      return (
        <Panel tone="warn" icon="coins" title="Not paid yet" code={parcel.code}>
          {head}
          <p>Nothing can move until the fare is recorded. Take the money, then enter it.</p>
          <SettleAtCounter
            code={parcel.code}
            disabled={busy || !canDispatch}
            onDone={() => onSettled(parcel.code)}
            onError={onError}
          />
        </Panel>
      );

    case 'awaiting-dropoff':
      return (
        <Panel tone="info" icon="inbox" title="The sender is bringing this in" code={parcel.code}>
          {head}
          <p>
            Check the box matches what is written, then take it in. The sender gets a receipt
            by text the moment you do.
          </p>
          <div className="scan-actions">
            <button
              type="button" className="btn btn-p btn-lg" disabled={busy || !canReceive}
              onClick={() => onReceive(parcel.code)}
            >
              <Icon name="check" size={17} />Received — await dispatch
            </button>
          </div>
          {canReceive && (
            <RunPicker
              runs={runs}
              parcelCode={parcel.code}
              destinationHint={parcel.destinationLabel}
              canCreate={canDispatch}
              label="Receive and put it straight on a run"
              // Custody first, then the manifest — a box cannot be on a
              // lorry it was never taken in hand to carry to.
              beforeLoad={(then) => onReceive(parcel.code, then)}
              onLoaded={(run) => onLoaded(parcel.code, run)}
              onError={onError}
            />
          )}
        </Panel>
      );

    case 'at-counter':
      return (
        <Panel tone="info" icon="box" title="On your shelf" code={parcel.code}>
          {head}
          <p>Already in your custody. It needs a vehicle going its way.</p>
          <RunPicker
            runs={runs}
            parcelCode={parcel.code}
            destinationHint={parcel.destinationLabel}
            canCreate={canDispatch}
            label="Put it on a run"
            onLoaded={(run) => onLoaded(parcel.code, run)}
            onError={onError}
          />
          {canArrival || canCarry ? (
            <p className="hint">
              Collecting in person instead?{' '}
              <button type="button" className="linkbtn" onClick={() => onHandOver(parcel)}>
                Hand it to the receiver now
              </button>
              .
            </p>
          ) : null}
        </Panel>
      );

    // The one question no server can answer. Asking it is one tap and
    // always right; guessing it from a free-text destination is silent
    // and sometimes wrong, and being wrong here means either a parcel
    // marked delivered at the wrong town or a receiver turned away.
    case 'moving':
      return (
        <Panel tone="info" icon="truck" title="This box is on the move" code={parcel.code}>
          {head}
          <p className="scan-fork-q">Where is it now?</p>
          <div className="scan-fork">
            <button
              type="button" className="scan-fork-opt" disabled={busy || !canCarry}
              onClick={() => onReceive(parcel.code)}
            >
              <span className="scan-fork-ic"><Icon name="refresh" size={22} /></span>
              <span>
                <strong>Passing through</strong>
                <small>Record that it reached {orgName} here and is moving on</small>
              </span>
            </button>
            <button
              type="button" className="scan-fork-opt is-final"
              disabled={busy || !custodyCapable || !(canArrival || canCarry)}
              onClick={() => onHandOver(parcel)}
            >
              <span className="scan-fork-ic"><Icon name="handshake" size={22} /></span>
              <span>
                <strong>This is its last stop</strong>
                <small>Check the receiver&rsquo;s code and hand it over</small>
              </span>
            </button>
          </div>
        </Panel>
      );

    case 'held':
      return (
        <Panel tone="warn" icon="shop" title="Waiting at a pickup point" code={parcel.code}>
          {head}
          <p>
            {parcel.agentName
              ? `Sitting at ${parcel.agentName} for the receiver to collect.`
              : 'Sitting at a pickup point for the receiver to collect.'}
          </p>
          <div className="scan-actions">
            <button
              type="button" className="btn btn-p btn-lg"
              disabled={busy || !custodyCapable}
              onClick={() => onHandOver(parcel)}
            >
              <Icon name="handshake" size={17} />Hand it to the receiver
            </button>
          </div>
        </Panel>
      );

    case 'failed':
      return (
        <Panel tone="warn" icon="alert-triangle" title="Delivery was attempted" code={parcel.code}>
          {head}
          <p>
            {parcel.deliveryAttempts} attempt{parcel.deliveryAttempts === 1 ? '' : 's'} so far
            {parcel.lastAttemptReason ? ` — last one: ${parcel.lastAttemptReason}.` : '.'}{' '}
            The receiver is expecting a call.
          </p>
          <div className="scan-actions">
            <button
              type="button" className="btn btn-p btn-lg"
              disabled={busy || !custodyCapable}
              onClick={() => onHandOver(parcel)}
            >
              <Icon name="handshake" size={17} />Try again — hand it over now
            </button>
            <Link className="btn btn-o" href={`/parcel-org?status=FAILED_DELIVERY`}>
              <Icon name="inbox" size={16} />See all failed
            </Link>
          </div>
        </Panel>
      );

    case 'closed':
      return (
        <Panel tone="ok" icon="check-circle" title={STATUS_LABEL[parcel.status] ?? parcel.status} code={parcel.code}>
          {head}
          <p>
            This box&rsquo;s journey is finished. Nothing more to do here — scanning it again
            will keep showing this.
          </p>
          <div className="scan-actions">
            <button type="button" className="btn btn-p" onClick={onReset}>
              <Icon name="qr" size={16} />Scan the next one
            </button>
          </div>
        </Panel>
      );
  }
}

function Panel({
  tone, icon, title, code, children,
}: {
  tone: 'ok' | 'info' | 'warn';
  icon: 'alert-triangle' | 'inbox' | 'tag' | 'box' | 'truck' | 'shop' | 'coins' | 'check-circle';
  title: string;
  code: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`scan-panel ${tone}`} aria-label={title}>
      <header className="scan-panel-head">
        <span className="scan-panel-ic" aria-hidden="true"><Icon name={icon} size={22} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{title}</h2>
          <p className="mono scan-panel-code">{code}</p>
        </div>
      </header>
      <div className="scan-panel-body">{children}</div>
    </section>
  );
}

/** The actual sticker for whatever was just scanned — same design as
 *  the label pool's own preview (LabelStockPanel's "Unused pool"),
 *  fitted to the console's own width so it never overflows on a
 *  phone. No `sig`: nothing this console resolves carries the label's
 *  signature, so this shows as an unverified — but still fully
 *  working — label. */
function ScanLabelPreview({
  code, route, orgName, orgLogoUrl,
}: { code: string; route?: string; orgName?: string; orgLogoUrl?: string }) {
  return (
    <div className="scan-label">
      <ScaledLabel code={code} route={route} orgName={orgName} orgLogoUrl={orgLogoUrl} />
      <PrintStyles />
    </div>
  );
}

/** Who it's for and where it's going — the two facts a clerk checks the
 *  box against before touching any button. */
function ParcelSummary({ parcel }: { parcel: OrgParcelRow }) {
  return (
    <dl className="scan-facts">
      <div>
        <dt>For</dt>
        <dd>{parcel.receiverName} <span className="mono">{parcel.receiverMsisdn}</span></dd>
      </div>
      <div>
        <dt>Going to</dt>
        <dd>{parcel.destinationLabel}</dd>
      </div>
      <div>
        <dt>From</dt>
        <dd>{parcel.originLabel}</dd>
      </div>
      {parcel.holderName && (
        <div>
          <dt>Held by</dt>
          <dd>{parcel.holderName}</dd>
        </div>
      )}
    </dl>
  );
}

function LabelNotes({ label }: { label: { itemDescription: string | null; destination: string | null; receiverName: string | null; receiverMsisdn: string | null; senderName: string | null } }) {
  return (
    <dl className="scan-facts">
      {label.itemDescription && <div><dt>What&rsquo;s inside</dt><dd>{label.itemDescription}</dd></div>}
      {label.destination && <div><dt>Going to</dt><dd>{label.destination}</dd></div>}
      {label.receiverName && (
        <div>
          <dt>For</dt>
          <dd>{label.receiverName} {label.receiverMsisdn && <span className="mono">{label.receiverMsisdn}</span>}</dd>
        </div>
      )}
      {label.senderName && <div><dt>From</dt><dd>{label.senderName}</dd></div>}
    </dl>
  );
}

/** The fare for a walk-in booked to pay at the desk. */
function SettleAtCounter({
  code, disabled, onDone, onError,
}: {
  code: string;
  disabled: boolean;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [pending, start] = useTransition();
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  return (
    <form
      className="scan-settle"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        start(async () => {
          const res = await settleAtCounter(code, value);
          if (!res.ok) { onError(res.error); return; }
          onDone();
        });
      }}
    >
      <label className="lab" htmlFor="settle-kes">What did the sender pay?</label>
      <div className="scan-settle-row">
        <span className="scan-settle-cur">KES</span>
        <input
          id="settle-kes" className="inp mono" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          inputMode="decimal" placeholder="0" disabled={disabled || pending}
        />
        <button type="submit" className="btn btn-p" disabled={!valid || disabled || pending}>
          {pending ? 'Recording…' : 'Record payment'}
        </button>
      </div>
    </form>
  );
}
