'use client';
import { displayKES, toCentsOrZero } from '@esoqo/domain';
import { Icon } from '@esoqo/ui';
import type { AwaitingIntakeView, ParcelStatusView } from './actions';
import {
  etaText, humanTime, isOffTimeline, statusLabel, statusMessage, statusTone, timelineFor,
} from './parcel-format';
import { ClaimPanel } from './ClaimPanel';
import { ReceiverAuthPanel } from './ReceiverAuthPanel';
import { TrackingMap } from './TrackingMap';

/**
 * One parcel, rendered for whoever holds its code — the sender, the
 * receiver, or anyone they forwarded it to.
 *
 * Shared by the "Track a parcel" lookup and the /t/<code> page every
 * SMS now links to, so the two can never tell different stories about
 * the same parcel. Everything it shows comes from the guest-safe
 * projection (see dbx.GetParcelStatus) — no sender or receiver names,
 * no phone numbers.
 */
export function ParcelStatusPanel({ parcel }: { parcel: ParcelStatusView | AwaitingIntakeView }) {
  // No handler has confirmed physical custody yet — looked up by a
  // service ticket number (see core-go's Parcel.serviceTicketNumber
  // schema comment). There is genuinely nothing else on this parcel to
  // show: no code, no route, no timeline position. Checked via `'message'
  // in parcel`, not `status === 'AWAITING_INTAKE'` — ParcelStatusView.status
  // is a plain string, so an equality check alone can't tell TypeScript
  // the two shapes apart; the two interfaces' actually-different fields
  // can. Narrows `parcel` to ParcelStatusView for everything below.
  if ('message' in parcel) {
    return (
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name="clock" size={18} />
        <p className="sub" style={{ margin: 0 }}>{parcel.message}</p>
      </div>
    );
  }
  if (parcel.preLabel) return <PreLabelPanel parcel={parcel} />;

  const eta = etaText(parcel);
  const stages = timelineFor(parcel);
  const reachedIndex = stages.findIndex(([s]) => s === parcel.status);
  const offTimeline = isOffTimeline(parcel.status);
  // The real custody timeline, when the server supplied one. Preferred
  // over the derived stepper because it is the actual history — every
  // leg with its time, from counter receipt to delivery — not a
  // reconstruction from the current status alone.
  const events = parcel.events ?? [];

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <p className="mono" style={{ margin: 0, fontWeight: 800, fontSize: '1.05rem', letterSpacing: '.04em' }}>
            {parcel.code}
          </p>
          <p className="sub" style={{ margin: '2px 0 0', fontSize: '.85rem' }}>
            {parcel.originLabel} → {parcel.destinationLabel}
          </p>
        </div>
        <StatusPill status={parcel.status} />
      </div>

      <p style={{ margin: '14px 0 0' }}>{statusMessage(parcel)}</p>

      {eta && (
        <p className="sub" style={{ margin: '6px 0 0', fontSize: '.85rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="clock" size={14} />{eta}
        </p>
      )}

      {/* Where it is, when there's honestly something to show — the
          component renders nothing for a parcel that isn't moving. */}
      <TrackingMap parcel={parcel} />

      {/* Waiting at a shop is an instruction, not a status — the
          receiver's next action is a walk to a specific door, so the
          address, hours and phone travel with it. */}
      {parcel.status === 'HELD_AT_AGENT' && parcel.agent && <AgentCard agent={parcel.agent} />}

      {/* A parcel that's off the happy path gets a card explaining why
          instead of a timeline of dots that would all read "hasn't
          happened yet" for something that already has. */}
      {offTimeline ? (
        <OffTimelineCard parcel={parcel} />
      ) : events.length > 1 ? (
        <EventsTimeline events={events} />
      ) : (
        <ol style={{ listStyle: 'none', margin: '20px 0 0', padding: 0 }}>
          {stages.map(([status, label], i) => {
            const reached = reachedIndex >= 0 && i <= reachedIndex;
            return (
              <li key={status} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* An empty ring rather than an icon for the unreached
                      steps — the sprite has no hollow-circle glyph, and
                      a ring reads as "not yet" more clearly than a
                      greyed-out tick would anyway. */}
                  {reached ? (
                    <Icon name="check-circle" size={18} />
                  ) : (
                    <span aria-hidden style={{
                      width: 18, height: 18, borderRadius: '50%',
                      border: '1.5px solid var(--line)', flexShrink: 0,
                    }} />
                  )}
                  {i < stages.length - 1 && (
                    <span aria-hidden style={{
                      width: 2, height: 26,
                      background: reached ? 'var(--brand, currentColor)' : 'var(--line)',
                      opacity: reached ? 0.4 : 1,
                    }} />
                  )}
                </span>
                <span style={{ paddingBottom: 12, fontWeight: reached ? 600 : 400, opacity: reached ? 1 : 0.55 }}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {parcel.status === 'DELIVERED' && <ProofOfDelivery parcel={parcel} />}

      <dl style={{ margin: '16px 0 0', display: 'grid', gap: 6 }}>
        {parcel.priceKes && (
          <Row label="Paid" value={`KES ${Number(parcel.priceKes).toLocaleString('en-KE')}`} mono />
        )}
        <Row label="Booked" value={humanTime(parcel.createdAt)} />
        {parcel.intakeConfirmedAt && (
          <Row label="Received" value={humanTime(parcel.intakeConfirmedAt)} />
        )}
        {parcel.deliveredAt && <Row label="Delivered" value={humanTime(parcel.deliveredAt)} />}
      </dl>

      {/* Everything above is what a stranger holding the code sees.
          These two are the door for the people it actually belongs to,
          and they ask for different proof on purpose: the delivery code
          only the receiver was sent, or the phone number already on the
          parcel. Neither is the tracking code, which anyone who handled
          the box also holds.

          Receiver-first, because that is who is standing in front of a
          counter wanting in — the sender is usually at a desk with time
          to wait for a text. */}
      <ReceiverAuthPanel code={parcel.code} />
      <ClaimPanel code={parcel.code} />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  const colors = {
    ok: { bg: 'var(--green-t, rgba(0,128,0,.08))', fg: 'var(--green, #1a7f37)' },
    warn: { bg: 'var(--amber-t, rgba(200,140,0,.1))', fg: 'var(--amber, #9a6700)' },
    bad: { bg: 'var(--red-t, rgba(200,0,0,.08))', fg: 'var(--red, #b42318)' },
    neutral: { bg: 'var(--bg-1, rgba(0,0,0,.05))', fg: 'inherit' },
  } as const;
  const c = colors[tone];
  return (
    <span style={{
      background: c.bg, color: c.fg, borderRadius: 999, padding: '4px 12px',
      fontSize: '.78rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {statusLabel(status)}
    </span>
  );
}

function AgentCard({ agent }: { agent: NonNullable<ParcelStatusView['agent']> }) {
  return (
    <div style={{
      marginTop: 14, border: '1.5px solid var(--brand, var(--line))', borderRadius: 10, padding: 14,
    }}>
      <p className="sub" style={{ margin: '0 0 4px', fontSize: '.78rem' }}>Collect from</p>
      <p style={{ margin: 0, fontWeight: 700 }}>{agent.name}</p>
      <p className="sub" style={{ margin: '2px 0 0', fontSize: '.85rem' }}>{agent.locationHint}</p>
      {agent.openingHours && (
        <p className="sub" style={{ margin: '2px 0 0', fontSize: '.85rem' }}>Open {agent.openingHours}</p>
      )}
      <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <a className="btn btn-o btn-sm" href={`tel:${agent.msisdn}`}>
          <Icon name="phone" size={14} />Call the shop
        </a>
        <a className="btn btn-o btn-sm" target="_blank" rel="noreferrer"
          href={`https://www.google.com/maps/search/?api=1&query=${agent.lat},${agent.lng}`}>
          <Icon name="pin" size={14} />Directions
        </a>
      </div>
      {toCentsOrZero(agent.holdingFeeKes) > 0 && (
        <p className="sub" style={{ margin: '10px 0 0', fontSize: '.8rem' }}>
          A KES {displayKES(agent.holdingFeeKes)} collection fee is payable at the shop.
        </p>
      )}
    </div>
  );
}

/**
 * The full history, straight from the server: booking, counter receipt,
 * each hand-over, delivery — plus the things that happened between them
 * which are not custody at all, like a receiver locking themselves out
 * of the delivery code or a new code being issued.
 *
 * Every entry used to be drawn as a green tick, on the reasoning that
 * everything on the list had already happened and so had gone right.
 * That held while the list was custody legs only. It stopped holding
 * the moment a failure could appear here, and a tick beside "Receiver
 * authentication failed" is not a cosmetic problem — it tells a worried
 * sender the opposite of the truth. Hence severity, which the server
 * sets per row.
 */
const EVENT_MARK = {
  INFO: { icon: 'check-circle', color: undefined },
  WARNING: { icon: 'alert-triangle', color: 'var(--amber, #9a6700)' },
  CRITICAL: { icon: 'alert-circle', color: 'var(--red, #b42318)' },
} as const;

function EventsTimeline({ events }: { events: NonNullable<ParcelStatusView['events']> }) {
  return (
    <ol style={{ listStyle: 'none', margin: '20px 0 0', padding: 0 }}>
      {events.map((e, i) => {
        // Defaulting to INFO keeps a response from an older core-go
        // (no severity field at all) rendering exactly as it did before.
        const mark = EVENT_MARK[e.severity ?? 'INFO'] ?? EVENT_MARK.INFO;
        return (
          <li key={`${e.at}-${i}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Icon name={mark.icon} size={18} style={mark.color ? { color: mark.color } : undefined} />
              {i < events.length - 1 && (
                <span aria-hidden style={{
                  width: 2, height: 26,
                  background: 'var(--brand, currentColor)', opacity: 0.4,
                }} />
              )}
            </span>
            <span style={{ paddingBottom: 12 }}>
              <span style={{ display: 'block', fontWeight: 600, color: mark.color }}>{e.label}</span>
              <span className="sub" style={{ fontSize: '.85rem' }}>{humanTime(e.at)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function OffTimelineCard({ parcel }: { parcel: ParcelStatusView }) {
  const tone = statusTone(parcel.status);
  const border = tone === 'bad' ? 'var(--red, #b42318)' : 'var(--amber, #9a6700)';
  return (
    <div style={{ marginTop: 18, border: `1.5px solid ${border}`, borderRadius: 10, padding: 14 }}>
      <p style={{ margin: 0, fontWeight: 700 }}>{statusLabel(parcel.status)}</p>
      {parcel.status === 'FAILED_DELIVERY' && (
        <>
          <p className="sub" style={{ margin: '4px 0 0', fontSize: '.85rem' }}>
            {parcel.deliveryAttempts === 1
              ? '1 attempt so far'
              : `${parcel.deliveryAttempts ?? 0} attempts so far`}
            {parcel.lastAttemptAt ? ` · last ${humanTime(parcel.lastAttemptAt)}` : ''}
          </p>
          {parcel.lastAttemptText && (
            <p style={{ margin: '8px 0 0' }}>Last time: {parcel.lastAttemptText}.</p>
          )}
        </>
      )}
      {parcel.status === 'CANCELLED' && parcel.cancelledAt && (
        <p className="sub" style={{ margin: '4px 0 0', fontSize: '.85rem' }}>
          Cancelled {humanTime(parcel.cancelledAt)}
          {parcel.cancellationReason ? ` — ${parcel.cancellationReason}` : ''}
        </p>
      )}
      {parcel.status === 'RETURNED_TO_SENDER' && parcel.lastAttemptReason && (
        <p className="sub" style={{ margin: '4px 0 0', fontSize: '.85rem' }}>
          Reason: {parcel.lastAttemptReason}
        </p>
      )}
    </div>
  );
}

/**
 * The evidence half of a delivery. This is what turns "it says
 * delivered but I never got it" from an argument into a question with
 * an answer — which is why the photo is fetched through the app's own
 * authorised proxy (see api/parcel-pod) rather than linked from a
 * bucket: a picture of somebody's doorway must not be enumerable.
 */
function ProofOfDelivery({ parcel }: { parcel: ParcelStatusView }) {
  if (!parcel.podPhotoUrl && !parcel.podReceivedByName) return null;
  return (
    <div style={{ marginTop: 18, border: '1px solid var(--line)', borderRadius: 10, padding: 14 }}>
      <p className="sub" style={{ margin: '0 0 8px', fontSize: '.78rem' }}>Proof of delivery</p>
      {parcel.podReceivedByName && (
        <p style={{ margin: '0 0 10px' }}>
          Received by <strong>{parcel.podReceivedByName}</strong>
          {parcel.podMethod === 'AGENT_COLLECTION' && ' at the pickup point'}
        </p>
      )}
      {parcel.podPhotoUrl && (
        // A plain <img>, not next/image: the source is a proxied,
        // private, per-parcel route (see api/parcel-pod) that the image
        // optimiser can neither cache nor resize meaningfully, and
        // routing a delivery photo through a shared optimiser cache is
        // exactly the leak the proxy exists to prevent.
        <img
          src={`/api/parcel-pod/${encodeURIComponent(parcel.code)}`}
          alt={`Parcel ${parcel.code} at the point of hand-over`}
          style={{ width: '100%', maxWidth: 320, borderRadius: 8, display: 'block' }}
        />
      )}
    </div>
  );
}

function PreLabelPanel({ parcel }: { parcel: ParcelStatusView }) {
  const info = parcel.preLabelInfo;
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <p className="mono" style={{ margin: 0, fontWeight: 800, fontSize: '1.05rem' }}>{parcel.code}</p>
        <StatusPill status="LABEL_PRINTED" />
      </div>
      {info ? (
        <>
          <p style={{ margin: '14px 0 10px' }}>{info.itemDescription}</p>
          <dl style={{ display: 'grid', gap: 6, margin: 0 }}>
            <Row label="Destination" value={info.destination} />
            <Row label="Sender" value={info.senderName} />
            <Row label="Sender contact" value={info.senderMsisdn} />
            <Row label="Receiver" value={info.receiverName} />
            <Row label="Receiver contact" value={info.receiverMsisdn} />
            <Row label="Item type" value={info.itemType} />
            <Row label="Weight" value={info.weightRangeKg} />
          </dl>
        </>
      ) : (
        <p style={{ margin: '14px 0 0' }}>This label hasn&apos;t been attached to a shipment yet.</p>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
      <dt className="sub" style={{ fontSize: '.85rem' }}>{label}</dt>
      <dd className={mono ? 'mono' : undefined} style={{ margin: 0, textAlign: 'right' }}>{value}</dd>
    </div>
  );
}
