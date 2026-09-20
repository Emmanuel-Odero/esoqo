import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { SESSION_COOKIE } from '@esoqo/auth';
import { goUrl } from './ticketing';
import { getMyParcelOrgs } from './my-parcel-orgs';

/**
 * Every place one signed-in person can be working, in one list.
 *
 * Before this, "which hats do I wear" was scattered: courier companies
 * only appeared in a card two thirds down /me, ticket organisers only on
 * /me/organiser, and once inside either console there was no way back
 * except signing out — which on the courier side threw away a shift
 * session a rider might not be able to re-mint. A person who runs a
 * matatu SACCO, a parcel company and their own record had to remember
 * three URLs.
 *
 * All three kinds are read with the PERSON's own bearer, never a
 * company-scoped one, so this list is "who am I on the books of" and
 * nothing more. Entering a courier company still mints its own session
 * (see enterParcelOrg) — listing a company here grants nothing.
 */
export type WorkspaceKind = 'personal' | 'ticket' | 'courier';

export interface Workspace {
  /** Stable React key and the value pages pass as `currentKey`. */
  key: string;
  kind: WorkspaceKind;
  id: string;
  name: string;
  /** What this workspace is, in the person's own words. */
  subtitle: string;
  /**
   * A plain link when the session already covers it (personal, ticket
   * organisers). Null for courier companies: entering one needs a
   * company-scoped session minted first, so those rows submit the
   * enterParcelOrg action instead of navigating.
   */
  href: string | null;
  /** A company that isn't trading yet is listed but can't be opened. */
  enterable: boolean;
  /** Why it can't be opened, or the person's role in it. */
  note?: string;
}

interface TicketOrgRow {
  ID: string;
  Name: string;
  Slug: string;
  Vertical: string;
  Status: string;
}

export const PERSONAL_WORKSPACE: Workspace = {
  key: 'personal',
  kind: 'personal',
  id: '',
  name: 'Esoqo',
  subtitle: 'Your own record',
  href: '/me',
  enterable: true,
};

/** Ticket organisers this person owns — core-go's GET /v1/me/orgs. */
async function listTicketOrgs(token: string): Promise<Workspace[]> {
  try {
    const res = await fetch(goUrl('/v1/me/orgs'), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const json = (await res.json().catch(() => null)) as { orgs?: TicketOrgRow[] | null } | null;
    return (json?.orgs ?? []).map((o) => ({
      key: `ticket:${o.ID}`,
      kind: 'ticket' as const,
      id: o.ID,
      name: o.Name,
      subtitle: o.Vertical === 'TRANSPORT' ? 'Transport organiser' : 'Events organiser',
      href: `/org/${o.ID}`,
      enterable: true,
      note: o.Status === 'ACTIVE' ? undefined : o.Status.toLowerCase(),
    }));
  } catch {
    return [];
  }
}

/**
 * Best-effort throughout: a switcher that fails to render because one
 * optional backend read timed out would strand somebody mid-shift. Each
 * source degrades to [] on its own, so a courier outage still leaves the
 * organisers listed and vice versa. Cached per request — the shell
 * renders this once per navigation across three different layouts.
 */
export const listWorkspaces = cache(async (): Promise<Workspace[]> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // No personal session means this is a staff-only login (a rider who
  // came in through their employer's own door). They get no switcher —
  // there is nothing of their own to switch to.
  if (!token) return [];

  const [ticketOrgs, courierOrgs] = await Promise.all([
    listTicketOrgs(token),
    getMyParcelOrgs(),
  ]);

  return [
    PERSONAL_WORKSPACE,
    ...ticketOrgs,
    ...courierOrgs.map((o): Workspace => ({
      key: `courier:${o.orgId}`,
      kind: 'courier',
      id: o.orgId,
      name: o.name,
      subtitle: 'Courier company',
      href: null,
      enterable: o.status === 'ACTIVE',
      // INTAKE_CLERK is a database enum, not a job title anybody says
      // out loud — "intake clerk" is.
      note: o.status === 'ACTIVE'
        ? o.role.toLowerCase().replace(/_/g, ' ')
        : 'not trading yet',
    })),
  ];
});
