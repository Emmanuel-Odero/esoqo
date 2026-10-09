import type { OrgParcelLabel, OrgParcelRow } from "@/lib/parcel-org-session";

/**
 * THE state machine for a parcel, and the single place that answers
 * "what can this person do to it right now".
 *
 * This lived under scan/ and was the Scanner's private business, which
 * is how the portal ended up with a second copy: the register's rows
 * carried their own hand-written status lists — ['RECEIVED_AT_COUNTER',
 * 'PICKED_UP', 'IN_TRANSIT'] for the SLA clock, `BOOKED ||
 * RECEIVED_AT_COUNTER` for the assign button — that no one had to keep
 * in step with this file. Two encodings of one machine drift, and the
 * drift shows up as a button that shouldn't be there.
 *
 * So: every surface derives its affordances from here. Adding a status
 * to core-go means editing stageFor() once, and every page that renders
 * parcels follows. Adding a verb means editing affordancesFor() once.
 *
 * Its own module, not part of actions.ts, because a 'use server' file
 * may only export async functions — a plain function beside the actions
 * is a build error, and the pure mapping below is exactly the part that
 * should be testable without a server at all.
 */

/**
 * What a clerk can do next, derived from the parcel's status alone.
 *
 * A closed vocabulary rather than the raw status, because the status is
 * a statement about the parcel and this is a statement about the PERSON
 * standing at the desk. Two statuses can mean the same job (PICKED_UP
 * and IN_TRANSIT are both "it's moving") and one status can mean two —
 * a moving parcel is either passing through or has arrived, which is
 * the one thing the server genuinely cannot know and therefore the one
 * thing the scanner asks.
 */
export type ScanStage =
  | "unpaid" // DRAFT_PENDING_PAYMENT — money first
  | "awaiting-dropoff" // BOOKED — the sender is walking in
  | "at-counter" // RECEIVED_AT_COUNTER — on our shelf, needs a run
  | "moving" // PICKED_UP | IN_TRANSIT — passing through, or arrived
  | "held" // HELD_AT_AGENT — on a pickup point's shelf
  | "failed" // FAILED_DELIVERY — came back, needs a decision
  | "closed"; // DELIVERED | CANCELLED | RETURNED_TO_SENDER

/** The counter still has to collect this parcel's fare. Separate from
 *  stageFor because a PAY_AT_COUNTER parcel is BOOKED / on the shelf
 *  while unpaid — its status says nothing about money. */
export function counterFareDue(p: { paymentMethod: string | null; paid: boolean }): boolean {
  return p.paymentMethod === 'PAY_AT_COUNTER' && !p.paid;
}

export function stageFor(status: string): ScanStage {
  switch (status) {
    case "DRAFT_PENDING_PAYMENT":
      return "unpaid";
    case "BOOKED":
      return "awaiting-dropoff";
    case "RECEIVED_AT_COUNTER":
      return "at-counter";
    case "PICKED_UP":
    case "IN_TRANSIT":
      return "moving";
    case "HELD_AT_AGENT":
      return "held";
    case "FAILED_DELIVERY":
      return "failed";
    default:
      // DELIVERED, CANCELLED, RETURNED_TO_SENDER, and anything a future
      // core-go adds. Defaulting to "closed" is the safe direction: an
      // unknown status shows the parcel and offers nothing, rather than
      // offering an action that might not apply to it.
      return "closed";
  }
}

/**
 * A verb a person can apply to a parcel — the closed vocabulary every
 * surface draws its buttons from.
 *
 * Deliberately not one-per-status: 'load' is the same job whether the
 * box just came over the counter or is passing through, and the button
 * should read the same in both places.
 */
export type ParcelVerb =
  | 'settle' // take the money — nothing moves before it
  | 'receive' // take custody over the counter
  | 'assign' // hand it to a named rider
  | 'load' // put it on a vehicle run
  | 'transit' // scan it through an intermediate stop
  | 'handover' // give it to the receiver, or to a pickup point
  | 'retry'; // failed delivery — try again or send it back

/**
 * What can be done to a parcel at a given stage, ignoring who is
 * asking. Capability gating stays with each surface (core-go refuses
 * the calls independently either way, see ADR-0003) — this answers the
 * prior question of whether the verb applies to the parcel AT ALL.
 */
export function affordancesFor(stage: ScanStage): readonly ParcelVerb[] {
  switch (stage) {
    case 'unpaid':
      return ['settle'];
    case 'awaiting-dropoff':
      // Receiving and loading in one gesture is the common counter
      // case; assigning skips the counter when a rider collects.
      return ['receive', 'assign', 'load'];
    case 'at-counter':
      return ['assign', 'load', 'handover'];
    case 'moving':
      // The one thing no server can know: is this its last stop?
      return ['transit', 'handover'];
    case 'held':
      return ['handover'];
    case 'failed':
      return ['retry', 'handover'];
    case 'closed':
      // Nothing. A delivered or cancelled parcel is a record, not work.
      return [];
  }
}

export function can(stage: ScanStage, verb: ParcelVerb): boolean {
  return affordancesFor(stage).includes(verb);
}

/**
 * Is the parcel still on the clock? Only a parcel we hold or are moving
 * can be late — one still awaiting its sender isn't ours to be late
 * with, and a closed one has stopped counting.
 */
export function isInFlight(status: string): boolean {
  const stage = stageFor(status);
  return stage === 'at-counter' || stage === 'moving';
}

/**
 * The human label for a status — the one thing stageFor's ScanStage
 * vocabulary genuinely can't carry on its own: BOOKED means two
 * different things to say out loud depending on how the parcel is
 * getting to the company. A scheduled pickup is a rider the company is
 * waiting ON; a self-dropoff is a sender the company is waiting FOR, at
 * its own counter — showing "Waiting for a rider" on the second one
 * told a clerk a rider was coming when nobody had been assigned, because
 * nobody needs to be: the sender is walking in.
 *
 * Was three separately hand-maintained copies (OrgParcelsTable,
 * ParcelDrawer, ScannerConsole's own STATUS_LABEL maps), none of them
 * originMethod-aware, all three wrong for the same case in the same way
 * — exactly the drift this file's own module comment warns a second
 * encoding invites.
 */
export function statusLabel(status: string, originMethod?: string): string {
  switch (status) {
    case "DRAFT_PENDING_PAYMENT":
      return "Awaiting payment";
    case "BOOKED":
      return originMethod === "SELF_DROPOFF" ? "Awaiting drop-off" : "Waiting for a rider";
    case "RECEIVED_AT_COUNTER":
      return "At the station";
    case "PICKED_UP":
      return "Picked up";
    case "IN_TRANSIT":
      return "On the way";
    case "FAILED_DELIVERY":
      return "Delivery attempted";
    case "HELD_AT_AGENT":
      return "At a pickup point";
    case "DELIVERED":
      return "Delivered";
    case "RETURNED_TO_SENDER":
      return "Returned to sender";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

/** What the scan turned out to be. The client renders one panel per
 *  `kind`, and for a parcel one panel per `stage` — so a new status can
 *  never silently fall through to a screen with no actions on it. */
export type ScanTarget =
  | { kind: "blank-label"; code: string; label: OrgParcelLabel }
  | { kind: "filled-label"; code: string; label: OrgParcelLabel }
  | { kind: "parcel"; code: string; stage: ScanStage; parcel: OrgParcelRow }
  | { kind: "ticket"; code: string }
  | { kind: "unknown"; code: string; reason: string };
