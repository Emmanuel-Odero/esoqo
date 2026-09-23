'use server';

// Same convention as ./actions.ts: server-side Go calls use the
// docker/compose service URL, falling back to localhost for bare-metal
// dev. Guest-only, same boundary as the rest of this directory — a
// walk-in requesting a ticket hasn't signed in and doesn't need to.
const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

const UNAVAILABLE = 'The counter service is unreachable. Check your connection and try again.';

interface GoErrorBody {
  error?: { code?: string; message?: string };
}

function goMessage(json: GoErrorBody | null, fallback: string): string {
  return typeof json?.error?.message === 'string' && json.error.message ? json.error.message : fallback;
}

async function goFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CORE_GO_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(UNAVAILABLE);
  }
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (!res.ok || !json) throw new Error(goMessage(json, UNAVAILABLE));
  return json as T;
}

export type CounterTicketChannel = 'KIOSK' | 'WEB_QR' | 'APP';

export interface CounterTicketView {
  id: string;
  orgId: string;
  serviceTicketNumber: string;
  msisdn: string;
  channel: CounterTicketChannel;
  status: 'WAITING' | 'CLAIMED' | 'EXPIRED' | 'CANCELLED';
  draftDetails?: unknown;
  claimedAt?: string | null;
  createdAt: string;
}

export async function actionCreateCounterTicket(
  orgId: string, msisdn: string, channel: CounterTicketChannel,
): Promise<CounterTicketView> {
  const { ticket } = await goFetch<{ ticket: CounterTicketView }>('/v1/parcels/counter-tickets', {
    method: 'POST',
    body: JSON.stringify({ orgId, msisdn, channel }),
  });
  return ticket;
}

export async function actionGetCounterTicket(id: string): Promise<CounterTicketView | null> {
  try {
    const { ticket } = await goFetch<{ ticket: CounterTicketView }>(
      `/v1/parcels/counter-tickets/${encodeURIComponent(id)}`,
    );
    return ticket;
  } catch {
    return null;
  }
}

// The customer's own "keep my place in the form while I wait" —
// see ParcelCounterTicket.draftDetails's own schema comment. Silent on
// failure: this is a courtesy autosave, not a step in the flow the
// customer is blocked on, and a save that failed because the clerk
// already claimed the ticket (see dbx.UpdateCounterTicketDraft) is not
// something the sender needs to be told about mid-form.
export async function actionSaveCounterTicketDraft(id: string, draftDetails: unknown): Promise<boolean> {
  try {
    await goFetch(`/v1/parcels/counter-tickets/${encodeURIComponent(id)}/draft`, {
      method: 'PATCH',
      body: JSON.stringify({ draftDetails }),
    });
    return true;
  } catch {
    return false;
  }
}
