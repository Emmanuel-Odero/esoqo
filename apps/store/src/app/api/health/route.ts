import { NextResponse } from 'next/server';
import { pingDatabase } from '@esoqo/db';

/**
 * The Kubernetes liveness probe for this service (httpGet /api/health).
 * It previously pointed at an ordinary page, which
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
    return NextResponse.json({ ok: false, reason: 'database_unreachable' }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
