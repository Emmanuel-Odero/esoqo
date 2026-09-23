"use client";

import {
  CounterForm as SharedCounterForm,
  type CounterActions,
  type CounterPricingOption,
} from "@esoqo/ui";
import { useAnnounce } from "@esoqo/a11y";
import {
  attachOrgLabelInfo,
  bookOrgCounterParcel,
  lookupOrgParcelByCode,
  receiveWalkInParcel,
  resolveOrgLabel,
  searchOrgCounterParties,
} from "../actions";

/**
 * The company's own counter — thin wiring over the shared Counter,
 * exactly as the Esoqo console does it (see apps/admin's CounterForm).
 *
 * Same screen either portal uses (scan → who → what → measure → book /
 * save-to-label, volumetric preview, party memory, offline queue),
 * bound here to the company's session: resolving and holding only its
 * own stock, completing names only from its own customers, booking onto
 * its own books. A clerk here can never touch another company's pad —
 * core-go scopes every one of these calls by session.
 *
 * No tabs. Three other jobs were crowded in beside this form and each
 * has gone to the page whose sentence it finishes:
 * - Receiving a drop-off → /parcel-org/scan, with the waiting worklist,
 *   because it starts with a box in someone's hands.
 * - A "New Shipment" tab that created vehicle runs → Dispatch, which
 *   already owned that job. It had displaced this very form, which is
 *   why the page's pricing and initialCode props were dead.
 * - Label stock → /parcel-org/settings/labels, because deciding how
 *   many stickers to have is provisioning, not selling.
 */
export function OrgCounterClient({
  initialCode,
  pricing,
  volumetricDivisor,
  orgName,
  orgLogoUrl,
}: {
  initialCode?: string;
  pricing: CounterPricingOption[];
  volumetricDivisor: number;
  orgName: string;
  orgLogoUrl?: string;
}) {
  const announce = useAnnounce();

  const actions: CounterActions = {
    getLabelInfo: async (code) => {
      const res = await resolveOrgLabel(code);
      if (res.ok) {
        const label = res.label;
        if (label.state === "spent") {
          // One box, every purpose: a spent label opens its own parcel
          // instead of refusing the scan. The counter shows what the
          // code IS; where it leads is the door (see the shared form's
          // parcel notice).
          return {
            ok: true,
            info: label,
            parcel: {
              code: label.parcelCode ?? label.code,
              status: label.parcelStatus ?? "BOOKED",
            },
          };
        }
        if (label.state === "voided") {
          return {
            ok: false,
            error:
              "That label was withdrawn — print a fresh one from Label stock instead.",
          };
        }
        if (label.state === "blank") return { ok: true, info: null };
        return { ok: true, info: label };
      }
      // Not stock. A fresh counter booking mints its tracking code on
      // the parcel (never a pre-printed sticker), so a later scan of it
      // doesn't resolve as a label — fall back to the parcel itself.
      const parcel = await lookupOrgParcelByCode(code);
      if (parcel) {
        return {
          ok: true,
          info: null,
          parcel: { code: parcel.code, status: parcel.status },
        };
      }
      return res;
    },
    attachLabelInfo: (code, info) => attachOrgLabelInfo(code, info),
    bookParcel: bookOrgCounterParcel,
    confirmIntake: async (code) => {
      const res = await receiveWalkInParcel(code);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
    searchParties: searchOrgCounterParties,
    // The label printed the moment a counter booking lands: resolve the
    // stock element's signature so it verifies genuine. Fresh-minted
    // codes aren't stock, so that resolve misses and the print falls
    // back to unverified — a working sticker either way.
    getLabelSig: async (code) => {
      const res = await resolveOrgLabel(code);
      return res.ok ? res.label.sig || undefined : undefined;
    },
  };

  return (
    <SharedCounterForm
      initialCode={initialCode}
      pricing={pricing}
      volumetricDivisor={volumetricDivisor}
      actions={actions}
      links={{
        nextHref: "/parcel-org/counter",
        parcelHref: (code) => `/parcel-org?q=${encodeURIComponent(code)}`,
        // Running out of stock mid-booking is exactly when you need it.
        labelsHref: "/parcel-org/settings/labels",
      }}
      announce={announce}
      orgName={orgName}
      orgLogoUrl={orgLogoUrl}
    />
  );
}
