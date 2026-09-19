'use client';

import { CounterForm as SharedCounterForm, type CounterActions } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  actionAttachParcelLabelInfo, actionConfirmParcelIntake, actionCounterBookParcel,
  actionGetParcelLabelInfo, actionSearchCounterParties,
  type ParcelPricingOption,
} from '../actions';

/**
 * The console counter — thin wiring over the shared Counter.
 *
 * The form itself (scan → who → what → measure → book / save-to-label,
 * volumetric preview, party memory, offline queue) lives in @esoqo/ui
 * so a courier company's own counter is the same screen, not a second
 * implementation drifting apart. This file only binds the Esoqo-staff
 * session actions and the console's own exits.
 */
export function CounterForm({
  initialCode, pricing, volumetricDivisor,
}: {
  initialCode?: string; pricing: ParcelPricingOption[]; volumetricDivisor: number;
}) {
  const announce = useAnnounce();
  const actions: CounterActions = {
    getLabelInfo: actionGetParcelLabelInfo,
    // The shared form speaks nulls (the company resolve returns them);
    // the admin input speaks undefined. Normalise at the boundary.
    attachLabelInfo: (code, info) => actionAttachParcelLabelInfo(code, {
      itemDescription: info.itemDescription,
      destination: info.destination ?? undefined,
      senderName: info.senderName ?? undefined,
      senderMsisdn: info.senderMsisdn ?? undefined,
      receiverName: info.receiverName ?? undefined,
      receiverMsisdn: info.receiverMsisdn ?? undefined,
      itemType: info.itemType ?? undefined,
      weightRangeKg: info.weightRangeKg ?? undefined,
      lengthCm: info.lengthCm ?? undefined,
      widthCm: info.widthCm ?? undefined,
      heightCm: info.heightCm ?? undefined,
    }),
    bookParcel: actionCounterBookParcel,
    confirmIntake: actionConfirmParcelIntake,
    searchParties: actionSearchCounterParties,
  };
  return (
    <SharedCounterForm
      initialCode={initialCode}
      pricing={pricing}
      volumetricDivisor={volumetricDivisor}
      actions={actions}
      links={{
        nextHref: '/parcels/counter',
        parcelHref: (code) => `/parcels?q=${encodeURIComponent(code)}`,
        labelsHref: '/parcels/labels',
      }}
      announce={announce}
    />
  );
}
