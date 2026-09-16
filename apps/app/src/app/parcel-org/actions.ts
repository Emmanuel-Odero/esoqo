'use server';

import { revalidatePath } from 'next/cache';
import {
  ParcelOrgUnauthorised, parcelOrgFetch, type ParcelOrgStaffRow,
} from '@/lib/parcel-org-session';

export type Result = { ok: true } | { ok: false; error: string };

/** Every action here forwards the portal's bearer and lets core-go
 *  decide. The org is read from the session on that side, so nothing in
 *  this file ever names a company — there is no parameter a browser
 *  could edit to act on somebody else's parcels. */
/** Always the failure variant — typed as such rather than as the wider
 *  Result so callers returning a richer success shape (see
 *  receiveWalkInParcel, which hands back the resolved code) can still
 *  funnel their errors through it. */
function toResult(e: unknown): { ok: false; error: string } {
  if (e instanceof ParcelOrgUnauthorised) {
    return { ok: false, error: 'Your shift session has expired — sign in again' };
  }
  return { ok: false, error: e instanceof Error ? e.message : 'That did not work' };
}

/**
 * The front desk's "I have this in hand" button for a self-drop-off
 * walk-in — calls the same custody-scan endpoint a courier's own pickup
 * scan uses (POST /v1/parcels/:code/handoff). Nothing here is
 * walk-in-specific on the server: a self-drop-off booking simply never
 * had a collector assigned, so the one FORBIDDEN gate ScanHandoff
 * checks (a different pre-assigned collector) never fires, and the
 * genuine first BOOKED->PICKED_UP transition fires the existing
 * sender/receiver SMS pair (see notify.ParcelIntakeConfirmed/
 * ParcelIntakeConfirmedToReceiver) and, for a courier company's own
 * parcel, the team dispatch summary (notify.ParcelOrgDispatchSummary).
 */
export async function receiveWalkInParcel(
  reference: string,
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  try {
    // `reference` is whatever the sender walked in with. Pre-intake that
    // is the service ticket number, not the tracking code — the code
    // does not exist to the sender yet (see Parcel.serviceTicketNumber).
    // The server resolves either and hands back the REAL code, which is
    // what has to go on the printed label: a ticket number stuck to the
    // box is a reference no later scan resolves.
    const res = await parcelOrgFetch<{ status: string; code: string }>(
      `/v1/parcels/${encodeURIComponent(reference)}/handoff`, { method: 'POST' },
    );
    revalidatePath('/parcel-org');
    revalidatePath('/parcel-org/receive');
    return { ok: true, code: res.code };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Recording the fare actually taken, in cash, for a parcel booked to be
 * paid at the counter.
 *
 * This is the other half of receiving a walk-in, and it had no home at
 * all until now: a PAY_AT_COUNTER booking lands in BOOKED with no price
 * on it (nobody has weighed the box yet), and nothing anywhere filled
 * that in afterwards — so every walk-in stayed permanently unpriced,
 * with no revenue split and nothing in any report. See
 * dbx.SettleCounterParcel.
 *
 * Deliberately a separate step from confirming receipt rather than one
 * combined button: custody and payment are different facts, and a box
 * that's physically in hand should be recorded as such even if the
 * sender is still counting out notes.
 */
export async function settleCounterParcel(code: string, priceKes: number): Promise<Result> {
  try {
    await parcelOrgFetch(`/v1/parcels/${encodeURIComponent(code)}/settle-counter`, {
      method: 'POST',
      body: JSON.stringify({ priceKes }),
    });
    revalidatePath('/parcel-org');
    revalidatePath('/parcel-org/receive');
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function assignOrgParcel(code: string, riderPartyId: string): Promise<Result> {
  try {
    await parcelOrgFetch(`/v1/parcel-orgs/me/parcels/${encodeURIComponent(code)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ riderPartyId }),
    });
    revalidatePath('/parcel-org');
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** A depot manager counting one of their own riders in, without
 *  routing every hand-over through Esoqo support. The server checks the
 *  rider is on this company's books before touching anything. */
export async function remitRiderCod(
  riderPartyId: string, amountKes: string, note?: string,
): Promise<{ ok: true; expectedKes: string; shortfallKes: string } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ expectedKes: string; shortfallKes: string }>(
      '/v1/parcel-orgs/me/cod/remit',
      { method: 'POST', body: JSON.stringify({ riderPartyId, amountKes, note: note || null }) },
    );
    revalidatePath('/parcel-org');
    return { ok: true, expectedKes: res.expectedKes, shortfallKes: res.shortfallKes };
  } catch (e) {
    const r = toResult(e);
    return { ok: false, error: r.ok ? 'That did not work' : r.error };
  }
}

// OrgPricingRow — mirrors dbx.ParcelPricing's JSON shape. Whatever this
// endpoint returns for a type is exactly what a sender's own quote will
// resolve to (see handleListMyOrgPricing's own comment) — this screen
// never computes a preview number of its own.
export interface OrgPricingRow {
  parcelType: string;
  weightLabel: string;
  minKes: string;
  maxKes: string;
}

export async function listOrgPricing(): Promise<OrgPricingRow[]> {
  const { pricing } = await parcelOrgFetch<{ pricing: OrgPricingRow[] | null }>(
    '/v1/parcel-orgs/me/pricing',
  );
  return pricing ?? [];
}

export async function saveOrgPricing(input: { parcelType: string; minKes: number; maxKes: number }): Promise<Result> {
  try {
    await parcelOrgFetch('/v1/parcel-orgs/me/pricing', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/parcel-org/pricing');
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function listOrgStaff(): Promise<ParcelOrgStaffRow[]> {
  const { staff } = await parcelOrgFetch<{ staff: ParcelOrgStaffRow[] | null }>(
    '/v1/parcel-orgs/me/staff',
  );
  return staff ?? [];
}

export async function saveOrgStaff(input: {
  id?: string;
  name: string;
  role: string;
  pin?: string;
  partyId?: string | null;
  active: boolean;
}): Promise<Result> {
  try {
    await parcelOrgFetch('/v1/parcel-orgs/me/staff', {
      method: 'POST',
      body: JSON.stringify({
        id: input.id ?? null,
        name: input.name,
        role: input.role,
        // Empty means "leave the PIN alone" on an update — making
        // somebody retype a PIN to change a role is the kind of friction
        // that ends with a whole depot sharing one login.
        pin: input.pin ?? '',
        partyId: input.partyId || null,
        active: input.active,
      }),
    });
    revalidatePath('/parcel-org/team');
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// ── Your own label stock ──
//
// Blank labels belong to whoever they were printed for, and core-go
// refuses a code bound to another company at booking time. That rule
// only means something once a company can actually get its own pad —
// until now the only screen that could mint or print one was Esoqo's.
//
// Nothing here names a company, for the same reason nothing else in
// this file does: the org comes from the session on the Go side, so
// there is no parameter a browser could edit to print or withdraw
// somebody else's stock.

export interface OrgLabelRow {
  code: string; createdAt: string; state: string;
  itemDescription: string | null; destination: string | null; senderName: string | null;
  infoAttachedAt: string | null; usedAt: string | null;
  voidedAt: string | null; voidedReason: string | null;
  batchId: string | null; orgName: string | null;
}

export interface OrgLabelBatchRow {
  batchId: string; createdAt: string;
  parcelOrgId: string | null; orgName: string | null;
  total: number; live: number; used: number; voided: number;
  voidedReason: string | null;
}

export async function listOrgLabels(
  state: string,
): Promise<{ labels: OrgLabelRow[]; counts: Record<string, number> }> {
  const res = await parcelOrgFetch<{ labels: OrgLabelRow[] | null; counts: Record<string, number> }>(
    `/v1/parcel-orgs/me/labels?state=${encodeURIComponent(state)}`,
  );
  return { labels: res.labels ?? [], counts: res.counts ?? {} };
}

export async function listOrgLabelBatches(): Promise<OrgLabelBatchRow[]> {
  const res = await parcelOrgFetch<{ batches: OrgLabelBatchRow[] | null }>(
    '/v1/parcel-orgs/me/labels/batches',
  );
  return res.batches ?? [];
}

export async function generateOrgLabels(
  count: number,
): Promise<{ ok: true; codes: string[]; batchId: string } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ codes: string[] | null; batchId: string }>(
      '/v1/parcel-orgs/me/labels/generate',
      { method: 'POST', body: JSON.stringify({ count }) },
    );
    revalidatePath('/parcel-org/labels');
    return { ok: true, codes: res.codes ?? [], batchId: res.batchId };
  } catch (e) {
    const r = toResult(e);
    return { ok: false, error: r.ok ? 'Could not print those labels' : r.error };
  }
}

/** Withdraw a whole pad — the "it was stolen from the Kisumu desk"
 *  button, without having to phone Esoqo to do it. Already-spent codes
 *  are untouched: each is on a parcel already moving. */
export async function voidOrgLabelBatch(
  batchId: string, reason: string,
): Promise<{ ok: true; voided: number } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ voided: number }>(
      `/v1/parcel-orgs/me/labels/batches/${encodeURIComponent(batchId)}/void`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
    revalidatePath('/parcel-org/labels');
    return { ok: true, voided: res.voided };
  } catch (e) {
    const r = toResult(e);
    return { ok: false, error: r.ok ? 'Could not withdraw that batch' : r.error };
  }
}
