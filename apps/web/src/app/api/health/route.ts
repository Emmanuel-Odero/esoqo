import { NextResponse } from 'next/server';
import { pingDatabase } from '@esoqo/db';

/**
 * Render's restart probe for this service (render.yaml's
 * healthCheckPath). It previously pointed at an ordinary page, which
 * renders fine even when the database is unreachable or the schema was
 * never migrated — so a deploy went green while every data-backed route
 * 500'd.
 *
 * A cheap reachability query, not a deep consistency check: a liveness
 * probe that fails on anything more than "can I reach my dependencies"
 * turns a transient problem into a restart loop.
 */
export const dynamic = 'force-dynamic'; // never served from the build cache

export async function GET() {
  const health = await pingDatabase();
  if (!health.reachable) {
    // The driver's own message is NOT forwarded. It can carry a
    // hostname, a port, or a fragment of the connection string, and this
    // response is stored by Render and readable by anyone who can reach
    // the service. The stable `reason` is the whole point of the probe.
    return NextResponse.json({ ok: false, reason: 'database_unreachable' }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
