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
