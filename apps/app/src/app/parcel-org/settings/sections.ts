import type { IconName } from '@esoqo/ui';

/**
 * Which settings sections a session may open, in the order they are
 * listed — shared by the Settings layout (to draw the sub-nav) and by
 * the Settings index (to decide where /parcel-org/settings lands).
 *
 * One list, so the first tab you can see is always the one the bare
 * URL sends you to. Two lists would eventually disagree and drop
 * somebody on a section their own nav doesn't offer.
 */
export interface SettingsSection {
  href: string;
  label: string;
  icon: IconName;
  capability: string | null;
  /** Only shown for a transport-enabled company — see
   *  ParcelOrg.offersTransport's own schema comment. */
  requiresTransport?: boolean;
}

const SECTIONS: readonly SettingsSection[] = [
  // Rates first: it is the one a manager comes back to, and the only
  // one that changes what a customer is charged.
  { href: '/parcel-org/settings/rates', label: 'Rates', icon: 'tag', capability: 'parcelorg.write' },
  { href: '/parcel-org/settings/labels', label: 'Label stock', icon: 'qr', capability: 'parcelorg.write' },
  // Stations and Routes sit together because they are the same kind of
  // thing — the company's own map. A station is a place it serves; a
  // route is the order it serves them in.
  { href: '/parcel-org/settings/stations', label: 'Stations', icon: 'pin', capability: 'parcelorgstation.write' },
  { href: '/parcel-org/settings/routes', label: 'Routes', icon: 'map', capability: 'parcelorg.write' },
  // Buses/bus routes/schedules — a second product line on the same
  // company, visible only once an admin has turned it on.
  { href: '/parcel-org/settings/transport', label: 'Transport', icon: 'truck', capability: 'parcelorg.transport', requiresTransport: true },
  { href: '/parcel-org/settings/team', label: 'Team', icon: 'users', capability: 'parcelorgstaff.write' },
  // Never gated: a rider holding a temporary invite PIN needs this more
  // than anyone, and a manager gate would lock out exactly them.
  { href: '/parcel-org/settings/security', label: 'Your sign-in', icon: 'key', capability: null },
];

export function sectionsFor(
  capabilities: readonly string[],
  offersTransport = false,
): SettingsSection[] {
  return SECTIONS.filter((s) => {
    if (s.requiresTransport && !offersTransport) return false;
    return s.capability === null || capabilities.includes(s.capability);
  });
}
