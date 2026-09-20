import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { sectionsFor } from './sections';

export const dynamic = 'force-dynamic';

/**
 * /parcel-org/settings has no content of its own — it lands on the
 * first section this session can actually open.
 *
 * Which differs by role, and that is the point: a manager lands on
 * Rates, a rider on their own sign-in, because those are the first
 * entries each of them can see in the shared list. A fixed landing
 * section would send riders to a page that immediately bounces them.
 */
export default async function ParcelOrgSettingsIndex() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  // Security is ungated, so this list is never empty in practice — the
  // fallback is here because the type can't say so, and landing on the
  // one section everybody can open is the right answer anyway.
  const [first] = sectionsFor(me.capabilities);
  redirect((first?.href ?? '/parcel-org/settings/security') as Route);
}
