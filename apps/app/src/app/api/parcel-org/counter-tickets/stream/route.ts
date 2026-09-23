import { parcelOrgToken } from "@/lib/parcel-org-session";
import { goUrl } from "@/lib/ticketing";

/**
 * Proxies the counter-ticket queue's SSE stream from core-go.
 *
 * A proxy, not a direct browser connection, for the same reason
 * apps/web's parcel-pod route is one: CORE_GO_API_URL is an internal
 * service address in every deployed environment, unreachable from a
 * browser. It also has to be a proxy specifically *here* rather than a
 * query-string token on a direct EventSource call, because the session
 * lives in an httpOnly cookie (see parcel-org-session.ts's own
 * comment on why) — only a server component can read it.
 *
 * Streams the upstream body straight through rather than buffering:
 * this is a long-lived connection, not a one-shot fetch, and the whole
 * point is that a byte written by core-go reaches the browser without
 * waiting for the connection to end.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = await parcelOrgToken();
  if (!token) {
    return new Response("Not signed in", { status: 401 });
  }
  const upstream = await fetch(goUrl("/v1/parcel-orgs/me/counter-tickets/stream"), {
    headers: { Authorization: `Bearer ${token}` },
    // Ties the upstream connection's lifetime to the browser's — when
    // the tab closes or navigates away, req.signal fires and this fetch
    // (and the pgxpool connection it's holding open in core-go) is torn
    // down instead of leaking.
    signal: req.signal,
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return new Response("Could not open the queue stream", { status: upstream.status || 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
