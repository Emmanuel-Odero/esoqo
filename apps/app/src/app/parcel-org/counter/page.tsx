import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ParcelOrgUnauthorised,
  getParcelOrgMe,
  parcelOrgFetch,
  type OrgParcelRow,
} from "@/lib/parcel-org-session";
import {
  listOrgCounterPricing,
  listOrgLabelBatches,
  listOrgLabels,
} from "../actions";
import { OrgCounterClient } from "./OrgCounterClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Counter — Esoqo",
  robots: { index: false, follow: false },
};

/**
 * The company's own counter: taking a parcel in over its desk.
 *
 * One screen, both jobs — how it used to be split is why the two pages
 * ever existed separately, and why the two scan boxes (PKG- label vs
 * TCK- ticket) ever sat apart. A single scan bar sits on top and routes
 * every code by what it is: ticket → custody at the desk, label →
 * booking form below. See ScanEverythingBar's own comment for the
 * routing, FrontDeskClient's for the desk, and OrgCounterClient for
 * how the desk and the booking form are wired behind the one box.
 *
 * `?code=` lands here pre-loaded — the labels register's "Book" button
 * sends it over, so a sticker on a box the handler already wrote on is
 * one gesture away from a booking.
 *
 * Both halves stay capability-gated, the same way the two pages each
 * were: the booking form needs parcelorg.dispatch (a rider has no
 * business minting bookings), the front-desk worklist parcelorg.carry
 * (the person waiting on a self-drop-off). A carry-only session — a
 * rider standing at the desk — gets the scanner and worklist without
 * the booking form. core-go refuses the underlying calls
 * independently, so a hand-typed URL gets nothing either.
 */
export default async function ParcelOrgCounterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; tab?: string; state?: string }>;
}) {
  const { code, tab, state } = await searchParams;
  const initialTab = code
    ? "book"
    : tab === "labels"
      ? "labels"
      : tab === "book"
        ? "book"
        : "receive";
  const labelState = ["all", "blank", "filled", "spent", "voided"].includes(
    state ?? "",
  )
    ? state!
    : "blank";

  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    // An expired shift session lands at the company's own door, not
    // /signin — a rider doesn't know their employer's slug, and the
    // customer sign-in is the wrong door entirely.
    if (e instanceof ParcelOrgUnauthorised) redirect("/parcel-org/signed-out");
    throw e;
  }

  const canDispatch = me.capabilities.includes("parcelorg.dispatch");
  const canCarry = me.capabilities.includes("parcelorg.carry");
  if (!canDispatch && !canCarry) redirect("/parcel-org");

  const [pricing, waiting, labelRegister, labelBatches] = await Promise.all([
    canDispatch ? listOrgCounterPricing(me.org.id) : Promise.resolve([]),
    canCarry
      ? parcelOrgFetch<{ parcels: OrgParcelRow[] | null }>(
          "/v1/parcel-orgs/me/parcels?status=BOOKED&originMethod=SELF_DROPOFF",
        ).then((r) => r.parcels ?? [])
      : Promise.resolve([]),
    listOrgLabels(labelState),
    listOrgLabelBatches(),
  ]);
  const divisor = Number(process.env.PARCEL_VOLUMETRIC_DIVISOR) || 5000;

  return (
    <>
      <div className="head">
        <div>
          <p className="kicker">{me.org.name}</p>
          <h1>Counter</h1>
          <p>
            Scan a ticket, label, or parcel code to start. Receive a drop-off,
            create a new booking, or manage label stock — one scanner routes
            every code to the right tab below.
          </p>
        </div>
      </div>
      <OrgCounterClient
        initialCode={code}
        initialTab={initialTab}
        labelState={labelState}
        pricing={pricing}
        volumetricDivisor={divisor}
        waiting={waiting}
        orgName={me.org.name}
        orgLogoUrl={me.org.logoUrl ?? undefined}
        canDispatch={canDispatch}
        canCarry={canCarry}
        labels={labelRegister.labels}
        labelCounts={labelRegister.counts}
        labelBatches={labelBatches}
      />
    </>
  );
}
