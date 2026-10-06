"use server";

import { revalidatePath } from "next/cache";
import {
  ParcelOrgRequestError,
  ParcelOrgUnauthorised,
  parcelOrgFetch,
} from "@/lib/parcel-org-session";

export type Result = { ok: true } | { ok: false; error: string };

function toResult(e: unknown): { ok: false; error: string } {
  if (e instanceof ParcelOrgUnauthorised) {
    return { ok: false, error: "Your shift session has expired — sign in again" };
  }
  if (e instanceof ParcelOrgRequestError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error ? e.message : "That did not work" };
}

export interface CounterTicketRow {
  id: string;
  orgId: string;
  serviceTicketNumber: string;
  msisdn: string;
  channel: "KIOSK" | "WEB_QR" | "APP";
  status: "WAITING" | "CLAIMED" | "EXPIRED" | "CANCELLED";
  draftDetails?: unknown;
  createdAt: string;
}

/** The queue's initial paint — see CounterQueueClient for the live SSE
 *  stream that keeps it current after this. */
export async function listCounterTicketQueue(): Promise<
  { ok: true; tickets: CounterTicketRow[] } | { ok: false; error: string }
> {
  try {
    const res = await parcelOrgFetch<{ tickets: CounterTicketRow[] | null }>(
      "/v1/parcel-orgs/me/counter-tickets/queue",
    );
    return { ok: true, tickets: res.tickets ?? [] };
  } catch (e) {
    return { ok: false, error: toResult(e).error };
  }
}

/** A clerk tapping "Serve" — atomic on core-go's side (see
 *  dbx.ClaimCounterTicket), so two clerks racing the same ticket can't
 *  both win; the loser just gets ALREADY_CLAIMED back. */
export async function claimCounterTicket(
  id: string,
): Promise<{ ok: true; ticket: CounterTicketRow } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ ticket: CounterTicketRow }>(
      `/v1/parcel-orgs/me/counter-tickets/${encodeURIComponent(id)}/claim`,
      { method: "POST" },
    );
    revalidatePath("/parcel-org/counter");
    return { ok: true, ticket: res.ticket };
  } catch (e) {
    return { ok: false, error: toResult(e).error };
  }
}

/** A clerk discarding a ticket — a sender who never showed, or one who
 *  walked away mid-service. See dbx.CancelCounterTicket for why this
 *  only ever works before a parcel exists (step "confirm"/"label" in
 *  ServeTicketPanel, or straight from the queue for a never-claimed
 *  ticket) — past that point, the parcel it became needs cancelling
 *  through its own flow instead. */
export async function cancelCounterTicket(
  id: string,
  reason?: string,
): Promise<{ ok: true; ticket: CounterTicketRow } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ ticket: CounterTicketRow }>(
      `/v1/parcel-orgs/me/counter-tickets/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ reason: reason?.trim() || undefined }),
      },
    );
    revalidatePath("/parcel-org/counter");
    return { ok: true, ticket: res.ticket };
  } catch (e) {
    return { ok: false, error: toResult(e).error };
  }
}

export interface BookCounterTicketInput {
  senderName: string;
  senderMsisdn: string;
  receiverName: string;
  receiverMsisdn: string;
  parcelType?: string;
  weightKg?: number;
  destinationLabel: string;
  senderDeclaredContents?: string;
  labelCode?: string;
}

/** The step a claimed ticket was always missing: turning the clerk's
 *  confirmed details into an actual, bookable parcel — see
 *  dbx.BookParcelFromCounterTicket for why this didn't already exist.
 *  Returns the real tracking code, which is what "receive" and every
 *  step after it now operate on, not the ticket's own name-shaped
 *  service ticket number. */
export async function bookCounterTicket(
  id: string,
  input: BookCounterTicketInput,
): Promise<
  | { ok: true; parcelId: string; code: string; serviceTicketNumber: string }
  | { ok: false; error: string }
> {
  try {
    const res = await parcelOrgFetch<{ parcelId: string; code: string; serviceTicketNumber: string }>(
      `/v1/parcel-orgs/me/counter-tickets/${encodeURIComponent(id)}/book`,
      {
        method: "POST",
        body: JSON.stringify({
          senderName: input.senderName.trim(), senderMsisdn: input.senderMsisdn.trim(),
          receiverName: input.receiverName.trim(), receiverMsisdn: input.receiverMsisdn.trim(),
          parcelType: input.parcelType || undefined, weightKg: input.weightKg,
          destinationLabel: input.destinationLabel.trim(),
          senderDeclaredContents: input.senderDeclaredContents?.trim() || undefined,
          labelCode: input.labelCode || undefined,
        }),
      },
    );
    revalidatePath("/parcel-org/counter");
    return { ok: true, parcelId: res.parcelId, code: res.code, serviceTicketNumber: res.serviceTicketNumber };
  } catch (e) {
    return { ok: false, error: toResult(e).error };
  }
}
