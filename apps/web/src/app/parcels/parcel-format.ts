import type { ParcelStatusView } from './actions';

/**
 * One vocabulary for parcel status and time, shared by every web
 * surface that renders a parcel.
 *
 * It exists because the raw enum used to leak straight into the UI —
 * a sender could see "PKG-X · IN_TRANSIT" in a list while the detail
 * page beside it showed a properly written sentence. A status string is
 * a database value; it is never what a person should read.
 *
 * Times get the same treatment. `new Date(x).toLocaleString()` renders
 * "12/09/2026, 14:33:07" — technically correct and useless to someone
 * asking where their parcel is. Everything here is Africa/Nairobi,
 * because that is where the parcels are.
 */

export const NAIROBI = 'Africa/Nairobi';

/** Short pill text. Kept to a few words — this goes in a table cell. */
export const STATUS_LABEL: Record<string, string> = {
  DRAFT_PENDING_PAYMENT: 'Awaiting payment',
  BOOKED: 'Booked',
  RECEIVED_AT_COUNTER: 'Received',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'On the way',
  FAILED_DELIVERY: 'Delivery attempted',
  HELD_AT_AGENT: 'Ready for collection',
  DELIVERED: 'Delivered',
  RETURNED_TO_SENDER: 'Returned to sender',
  CANCELLED: 'Cancelled',
  // A pre-printed label (see dbx.ParcelLabelStock) scanned before it was
  // ever attached to a real booking — never has a route or a price.
  LABEL_PRINTED: 'Pre-printed label',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** The tone a status pill should carry. Only three, deliberately:
 *  anything needing attention is amber, anything closed unhappily is
 *  red, everything else is neutral progress. */
export function statusTone(status: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  switch (status) {
    case 'DELIVERED':
      return 'ok';
    case 'FAILED_DELIVERY':
    case 'HELD_AT_AGENT':
      return 'warn';
    case 'CANCELLED':
    case 'RETURNED_TO_SENDER':
      return 'bad';
    default:
      return 'neutral';
  }
}

/**
 * The sentence a person actually reads — who has it, what happens next.
 * Mirrors mobile's parcelStatusMessage so both clients tell the same
 * story about the same row.
 */
export function statusMessage(p: ParcelStatusView): string {
  switch (p.status) {
    case 'DRAFT_PENDING_PAYMENT':
      return 'This booking isn’t paid for yet. Complete payment and we’ll arrange a courier.';
    case 'BOOKED':
      return 'Paid and booked. A courier will collect it shortly.';
    case 'RECEIVED_AT_COUNTER':
      return 'Received at the counter. A courier will pick it up for delivery.';
    case 'PICKED_UP':
      return 'A courier has collected it and is on the way.';
    case 'IN_TRANSIT':
      return 'On its way to the receiver.';
    case 'FAILED_DELIVERY': {
      const why = p.lastAttemptText ? ` — ${p.lastAttemptText}` : '';
      const n = p.deliveryAttempts ?? 1;
      if (n >= 3) {
        return `We’ve tried ${n} times to deliver this${why}. Get in touch or it goes back to the sender.`;
      }
      return `A courier tried to deliver this${why}. They’ll try again.`;
    }
    case 'HELD_AT_AGENT':
      return p.agent
        ? `Waiting for collection at ${p.agent.name}. Bring the delivery code.`
        : 'Waiting for collection at a pickup point.';
    case 'DELIVERED':
      return p.podReceivedByName
        ? `Delivered and received by ${p.podReceivedByName}.`
        : 'Delivered.';
    case 'RETURNED_TO_SENDER':
      return 'This parcel couldn’t be delivered and has gone back to the sender.';
    case 'CANCELLED':
      return 'This booking was cancelled.';
    case 'LABEL_PRINTED':
      return 'This label hasn’t been attached to a shipment yet.';
    default:
      return statusLabel(p.status);
  }
}

/**
 * The happy-path timeline. FAILED_DELIVERY, HELD_AT_AGENT, CANCELLED
 * and RETURNED_TO_SENDER are deliberately absent: they aren't stages,
 * they're departures from the path, and rendering one as an unreached
 * dot would read as "hasn't happened yet" for something that very much
 * has. Those statuses get their own card instead.
 *
 * RECEIVED_AT_COUNTER sits between Booked and Picked up, but only for a
 * parcel that actually went through a counter — see timelineFor.
 */
export const TIMELINE: [status: string, label: string][] = [
  ['BOOKED', 'Booked'],
  ['RECEIVED_AT_COUNTER', 'Received at counter'],
  ['PICKED_UP', 'Collected'],
  ['IN_TRANSIT', 'On the way'],
  ['DELIVERED', 'Delivered'],
];

/**
 * The stages that actually apply to this parcel. A scheduled pickup
 * never sits at a counter, so drawing "received at counter" as a
 * reached dot for it would claim something that never happened; the
 * stage is kept only when the parcel genuinely has a counter event (a
 * self-drop-off, or an Esoqo desk receipt recorded as one).
 */
export function timelineFor(p: ParcelStatusView): [status: string, label: string][] {
  const counter = p.status === 'RECEIVED_AT_COUNTER'
    || (p.events ?? []).some((e) => e.status === 'RECEIVED_AT_COUNTER');
  return counter ? TIMELINE : TIMELINE.filter(([s]) => s !== 'RECEIVED_AT_COUNTER');
}

export function isOffTimeline(status: string): boolean {
  return !TIMELINE.some(([s]) => s === status);
}

/** Human time. "Today, 2:33 PM" / "Yesterday, 9:05 AM" / "12 Sep, 2:33 PM". */
export function humanTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-KE', {
    hour: 'numeric', minute: '2-digit', timeZone: NAIROBI,
  });
  const dayKey = (x: Date) => x.toLocaleDateString('en-KE', { timeZone: NAIROBI });
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(now)) return `Today, ${time}`;
  if (dayKey(d) === dayKey(yesterday)) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString('en-KE', {
    day: 'numeric', month: 'short', timeZone: NAIROBI,
  });
  return `${date}, ${time}`;
}

/**
 * The delivery promise, phrased as a promise. Returns null when there
 * is no SLA configured for the type or the parcel is already closed —
 * "arriving by" on a delivered parcel is noise, and on an overdue one
 * it's worse than noise, so that case gets its own honest wording.
 */
export function etaText(p: ParcelStatusView): string | null {
  const closed = ['DELIVERED', 'CANCELLED', 'RETURNED_TO_SENDER'].includes(p.status);
  if (closed || !p.slaDeadlineAt) return null;
  const deadline = new Date(p.slaDeadlineAt);
  if (Number.isNaN(deadline.getTime())) return null;
  if (deadline.getTime() < Date.now()) {
    return 'Running later than promised — we’re on it.';
  }
  return `Arriving by ${humanTime(p.slaDeadlineAt)}`;
}
