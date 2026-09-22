/**
 * Proxies one walk-in ticket's SSE stream from core-go, so the
 * customer's own "you'll be served shortly" screen flips to "you're
 * being served" without a poll loop.
 *
 * Public — the ticket id itself is the bearer credential (see
 * core-go's dbx.GetCounterTicket comment) — but still a proxy, not a
 * direct browser connection: CORE_GO_API_URL is an internal service
 * address in every deployed environment (same reasoning
 * api/parcel-pod's own comment gives), unreachable from a browser
 * regardless of auth.
 */

const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(
    `${CORE_GO_URL}/v1/parcels/counter-tickets/${encodeURIComponent(id)}/stream`,
    { signal: req.signal, cache: 'no-store' },
  );
  if (!upstream.ok || !upstream.body) {
    return new Response('Could not open that ticket\'s stream', { status: upstream.status || 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
