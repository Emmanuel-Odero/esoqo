'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '@esoqo/ui';
import type { OrgParcelRow } from '@/lib/parcel-org-session';
import { DemoPhoneSpan } from '@/components/DemoContact';
import { affordancesFor, stageFor } from './parcel-stages';

/**
 * The whole parcel, before anything is done to it.
 *
 * Every action surface in this portal used to put the verb on the row:
 * the register offered "Assign" beside four truncated columns, and the
 * front desk offered "Confirm" — which takes legal custody of somebody
 * else's property — showing only a receiver's name and a destination.
 * Neither let the operator SEE the thing first. That is how a box gets
 * signed for against the wrong record, and the person who did it had no
 * way to have known.
 *
 * So: the row opens this, and the verbs live in here, under the facts
 * they apply to. The Scanner already worked this way (it draws a
 * ParcelSummary above its buttons) — this brings the desk surfaces in
 * line with it rather than inventing a second pattern.
 *
 * Deliberately a drawer, not a page: the operator is working a list and
 * has to come straight back to it. Deliberately not a fetch either —
 * OrgParcelRow already carries the whole record the register holds, so
 * opening this costs nothing and works offline-ish on a slow desk.
 *
 * `actions` is a slot rather than a built-in set, because which verbs
 * are legal is the CALLER's business (see parcel-stages.ts for what the
 * parcel's own state allows). The drawer states the facts and hosts
 * whatever the caller is allowed to do about them.
 */
export function ParcelDrawer({
  parcel, onClose, canSeeEarnings = false, actions,
}: {
  parcel: OrgParcelRow;
  onClose: () => void;
  canSeeEarnings?: boolean;
  actions?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, focus starts inside, and the page behind stops
  // scrolling — the three things that make an overlay feel like a
  // control rather than a layer somebody is stuck under.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const stage = stageFor(parcel.status);
  const verbs = affordancesFor(stage);
  const overdue = Boolean(
    parcel.slaDeadlineAt
    && (stage === 'at-counter' || stage === 'moving')
    && new Date(parcel.slaDeadlineAt) < new Date(),
  );

  return (
    <div
      className="pdrawer-scrim"
      // A mouse-only convenience: Escape is the keyboard route out (see
      // the effect above) and the dialog holds its own focus, so the
      // backdrop is presentational rather than a second control to tab
      // through. Closing on mousedown-target rather than click means a
      // text selection dragged out of the panel doesn't dismiss it.
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="pdrawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Parcel ${parcel.code}`}
      >
        <header className="pdrawer-head">
          <div>
            <span className="pdrawer-code mono">{parcel.code}</span>
            <div className="pdrawer-pills">
              <span className={`pill ${pillFor(stage)}`}>{STATUS_LABEL[parcel.status] ?? parcel.status}</span>
              {overdue && <span className="pill p-bad">Past SLA</span>}
              {parcel.deliveryAttempts > 0 && (
                <span className="pill p-warn">
                  {parcel.deliveryAttempts} failed {parcel.deliveryAttempts === 1 ? 'try' : 'tries'}
                </span>
              )}
              {/* A lock is worth a pill of its own, above the fold: it
                  is the one state on this record that has stopped the
                  parcel and needs somebody here to decide something. */}
              {parcel.receiverAuthHardLockedAt
                ? <span className="pill p-bad">Locked — needs a new code</span>
                : parcel.receiverAuthLockedAt && <span className="pill p-warn">Receiver locked out</span>}
            </div>
          </div>
          <button ref={closeRef} className="btn btn-o btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="pdrawer-body">
          {/* The receiver first: it is the fact a clerk checks the box
              against, and the one a mistake is most expensive in. */}
          <section className="pdrawer-block">
            <h3>Who it&rsquo;s for</h3>
            <dl className="pdrawer-dl">
              <div>
                <dt>Receiver</dt>
                <dd>
                  {parcel.receiverName || '—'}
                  <DemoPhoneSpan msisdn={parcel.receiverMsisdn} className="sub mono" />
                </dd>
              </div>
              <div>
                <dt>Collecting at</dt>
                <dd>{parcel.destinationLabel || '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="pdrawer-block">
            <h3>The journey</h3>
            <dl className="pdrawer-dl">
              <div>
                <dt>From</dt>
                <dd>{parcel.originLabel || '—'}</dd>
              </div>
              <div>
                <dt>Booked</dt>
                <dd>{fmt(parcel.createdAt)}</dd>
              </div>
              <div>
                <dt>Came in as</dt>
                <dd>{ORIGIN_LABEL[parcel.originMethod] ?? humanise(parcel.originMethod)}</dd>
              </div>
              {parcel.slaDeadlineAt && (
                <div>
                  <dt>Due by</dt>
                  <dd className={overdue ? 'pdrawer-late' : undefined}>{fmt(parcel.slaDeadlineAt)}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="pdrawer-block">
            <h3>Handling</h3>
            <dl className="pdrawer-dl">
              <div>
                <dt>In custody with</dt>
                <dd>{parcel.agentName ?? parcel.holderName ?? 'Nobody yet'}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{TYPE_LABEL[parcel.parcelType] ?? humanise(parcel.parcelType)}</dd>
              </div>
              {parcel.externalRef && (
                <div>
                  <dt>Their number</dt>
                  <dd className="mono">{parcel.externalRef}</dd>
                </div>
              )}
              {parcel.lastAttemptReason && (
                <div>
                  <dt>Last attempt</dt>
                  <dd>{parcel.lastAttemptReason}</dd>
                </div>
              )}
              {canSeeEarnings && (
                <div>
                  <dt>You earn</dt>
                  <dd className="mono">
                    {parcel.orgEarningsKes
                      ? `KES ${Number(parcel.orgEarningsKes).toLocaleString('en-KE')}`
                      : '—'}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* Only rendered when there is something to say. A parcel
              whose receiver verified first time, or never tried, has no
              business carrying an empty "Receiver verification" heading
              — that is how a drawer becomes a form nobody reads. */}
          {(parcel.receiverAuthAttempts > 0
            || parcel.receiverAuthLockedAt
            || parcel.receiverAuthHardLockedAt
            || parcel.deliveryCodeVersion > 1
            || parcel.courierEarningsHeldUntil) && (
            <section className="pdrawer-block">
              <h3>Receiver verification</h3>
              <dl className="pdrawer-dl">
                <div>
                  <dt>Wrong codes</dt>
                  <dd>{parcel.receiverAuthAttempts}</dd>
                </div>
                {parcel.receiverAuthHardLockedAt ? (
                  <div>
                    <dt>Hard locked</dt>
                    <dd className="pdrawer-late">{fmt(parcel.receiverAuthHardLockedAt)}</dd>
                  </div>
                ) : parcel.receiverAuthLockedAt && (
                  <div>
                    <dt>Locked</dt>
                    <dd className="pdrawer-late">{fmt(parcel.receiverAuthLockedAt)}</dd>
                  </div>
                )}
                {parcel.deliveryCodeVersion > 1 && (
                  <div>
                    <dt>Delivery code</dt>
                    <dd>Reissued {parcel.deliveryCodeVersion - 1}×</dd>
                  </div>
                )}
                {parcel.courierEarningsHeldUntil && (
                  <div>
                    <dt>Courier pay held</dt>
                    <dd>until {fmt(parcel.courierEarningsHeldUntil)}</dd>
                  </div>
                )}
              </dl>
              <p className="sub" style={{ margin: '8px 0 0' }}>
                {parcel.receiverAuthHardLockedAt
                  ? 'They have used every attempt. Issue a new delivery code — both the sender and the receiver are texted it.'
                  : parcel.receiverAuthLockedAt
                    ? 'Allow two more tries, or issue a new code if they no longer have theirs.'
                    : parcel.courierEarningsHeldUntil
                      ? 'This was closed by the receiver at a pickup point, with no staff witness. Release the pay once you are satisfied it was collected.'
                      : 'The receiver has mistyped their delivery code. Three wrong codes locks the parcel.'}
              </p>
            </section>
          )}
        </div>

        {/* Verbs under the facts, never beside a truncated row. When a
            parcel's own state allows nothing (it is delivered, or
            cancelled), say so rather than showing an empty strip. */}
        <footer className="pdrawer-foot">
          {actions ?? (
            verbs.length === 0
              ? <p className="sub">This parcel&rsquo;s journey is closed — nothing left to do to it.</p>
              : <p className="sub">Nothing you can do to this one from here.</p>
          )}
        </footer>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT_PENDING_PAYMENT: 'Awaiting payment',
  BOOKED: 'Waiting for a rider',
  RECEIVED_AT_COUNTER: 'At the station',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'On the way',
  FAILED_DELIVERY: 'Delivery attempted',
  HELD_AT_AGENT: 'At a pickup point',
  DELIVERED: 'Delivered',
  RETURNED_TO_SENDER: 'Returned to sender',
  CANCELLED: 'Cancelled',
};

// The only two values ParcelOriginMethod has. The drawer showed raw
// enum text for anything it didn't know, so a clerk read
// "SCHEDULED_PICKUP" on a record meant to reassure them it was right.
const ORIGIN_LABEL: Record<string, string> = {
  SELF_DROPOFF: 'Sender is dropping it off',
  SCHEDULED_PICKUP: 'We collect it from the sender',
};

const TYPE_LABEL: Record<string, string> = {
  ENVELOPE_DOCUMENT: 'Envelope / document',
  SMALL: 'Small parcel',
  MEDIUM: 'Medium parcel',
  LARGE: 'Large parcel',
  HEAVY_OVERSIZE: 'Heavy / oversize',
};

/** Anything the maps above don't carry — a value core-go added since —
 *  reads as words rather than as a constant name. */
function humanise(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase().trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '—';
}

function pillFor(stage: ReturnType<typeof stageFor>): string {
  switch (stage) {
    case 'closed': return 'p-ok';
    case 'failed': return 'p-bad';
    case 'unpaid': case 'held': return 'p-warn';
    default: return 'p-info';
  }
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}
