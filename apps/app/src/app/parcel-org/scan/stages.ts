import type { OrgParcelLabel, OrgParcelRow } from "@/lib/parcel-org-session";

/**
 * What the scanner is looking at, and what that means for the person
 * holding it.
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

/** What the scan turned out to be. The client renders one panel per
 *  `kind`, and for a parcel one panel per `stage` — so a new status can
 *  never silently fall through to a screen with no actions on it. */
export type ScanTarget =
  | { kind: "blank-label"; code: string; label: OrgParcelLabel }
  | { kind: "filled-label"; code: string; label: OrgParcelLabel }
  | { kind: "parcel"; code: string; stage: ScanStage; parcel: OrgParcelRow }
  | { kind: "ticket"; code: string }
  | { kind: "unknown"; code: string; reason: string };
