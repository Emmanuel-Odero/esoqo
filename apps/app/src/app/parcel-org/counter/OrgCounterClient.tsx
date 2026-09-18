'use client';

import { CounterForm as SharedCounterForm, type CounterActions, type CounterPricingOption } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  attachOrgLabelInfo, bookOrgCounterParcel, receiveWalkInParcel,
  resolveOrgLabel, searchOrgCounterParties,
} from '../actions';

/**
 * The company's own counter — thin wiring over the shared Counter.
 *
 * Same screen the Esoqo console uses (scan → who → what → measure →
 * book / save-to-label, volumetric preview, party memory, offline
 * queue), bound here to the company's session: resolving and holding
 * only its own stock, completing names only from its own customers,
 * booking onto its own books. A clerk here can never touch another
 * company's pad — core-go scopes every one of these calls by session.
 */
export function OrgCounterClient({
  initialCode, pricing, volumetricDivisor,
}: {
  initialCode?: string; pricing: CounterPricingOption[]; volumetricDivisor: number;
}) {
  const announce = useAnnounce();
  const actions: CounterActions = {
    getLabelInfo: async (code) => {
      const res = await resolveOrgLabel(code);
      if (!res.ok) return res;
      const label = res.label;
      if (label.state === 'spent') {
        return { ok: false, error: 'That label is already bound to a booked parcel — open it from your parcels list instead.' };
      }
      if (label.state === 'voided') {
        return { ok: false, error: 'That label was withdrawn — print a fresh one from Labels instead.' };
      }
      if (label.state === 'blank') return { ok: true, info: null };
      return { ok: true, info: label };
    },
    attachLabelInfo: (code, info) => attachOrgLabelInfo(code, info),
    bookParcel: bookOrgCounterParcel,
    confirmIntake: async (code) => {
      const res = await receiveWalkInParcel(code);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
    searchParties: searchOrgCounterParties,
  };
  return (
    <SharedCounterForm
      initialCode={initialCode}
      pricing={pricing}
      volumetricDivisor={volumetricDivisor}
      actions={actions}
      links={{
        nextHref: '/parcel-org/counter',
        parcelHref: (code) => `/parcel-org?q=${encodeURIComponent(code)}`,
        labelsHref: '/parcel-org/labels',
      }}
      announce={announce}
    />
  );
}
