import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ParcelOrgUnauthorised,
  getParcelOrgMe,
} from "@/lib/parcel-org-session";
import { listOrgCounterPricing } from "../actions";
import { CustomParcelPanel } from "../CustomParcelPanel";
import { OrgCounterClient } from "./OrgCounterClient";
import { listCounterTicketHistory, listCounterTicketQueue } from "../counter-queue/actions";
import { CounterQueueClient } from "../counter-queue/CounterQueueClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Counter — Esoqo",
  robots: { index: false, follow: false },
};

/**
 * The company's own counter: selling a parcel's carriage over its desk.
 *
 * One job, stated as a sentence the page can finish — this is where you
 * BOOK. Quote it, take the sender's and receiver's details, measure it,
 * print its sticker.
 *
 * `?code=` lands here pre-loaded — the label register's "Book" button
 * sends it over, so a sticker on a box the handler already wrote on is
 * one gesture away from a booking.
 *
 * Three jobs that used to share this page have gone elsewhere: receiving
 * a drop-off to the Scanner, vehicle runs to Dispatch, and label stock
 * to Settings. See OrgCounterClient for why each. That also means this
 * page no longer opens for a carry-only session: a rider has no business
 * minting bookings, and there is nothing else here for them. core-go
 * refuses the underlying calls independently (see ADR-0003), so a
 * hand-typed URL gets nothing either.
 */
export default async function ParcelOrgCounterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

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
  const canWrite = me.capabilities.includes("parcelorg.write");
  // parcelorg.intake — INTAKE_CLERK's own bundle (see
  // authsvc.ParcelStaffCapabilities) — reaches this page too: serving
  // the walk-in queue and booking the parcel that follows IS the
  // intake job, same as dispatch desk staff minting a booking directly.
  const canIntake = me.capabilities.includes("parcelorg.intake");
  if (!canDispatch && !canIntake) redirect("/parcel-org");

  const pricing = await listOrgCounterPricing(me.org.id);
  // The whole board — waiting queue, the company's in-flight cases and
  // the register of closed ones — comes from the same session-scoped
  // calls the client re-runs on every SSE signal, so what this page
  // paints is never a shape the live view couldn't reproduce.
  const queue = canIntake ? await listCounterTicketQueue() : null;
  const history = canIntake ? await listCounterTicketHistory() : null;
  const divisor = Number(process.env.PARCEL_VOLUMETRIC_DIVISOR) || 5000;

  return (
    <>
      <div className="head">
        <div>
          <p className="kicker">{me.org.name}</p>
          <h1>Counter</h1>
          <p>
            Book a parcel over the desk. A box already in someone&rsquo;s hands
            belongs on the Scanner.
          </p>
        </div>
        {/* Bulk/custom intake — booking by any other name, so its
            trigger lives beside the booking desk's own actions. It used
            to render inline on the page (and, earlier still, on the
            parcels register); now it's a dialog, so choosing it doesn't
            cost every counter session a second form to scroll past. */}
        {canWrite && (
          <div className="actions">
            <CustomParcelPanel />
          </div>
        )}
      </div>
      {/* A failed board fetch used to render as nothing at all — the
          whole queue silently absent, indistinguishable from "no one
          is waiting". Say so instead: a desk that can't see its own
          line needs to know it, not infer it. */}
      {canIntake && queue && !queue.ok && (
        <div className="card" style={{ padding: 18, marginBottom: 20 }}>
          <p className="sub" style={{ margin: 0, color: "var(--red, #b42318)", fontSize: ".9rem" }}>
            {queue.error} — the counter queue could not be loaded. Refresh to try again.
          </p>
        </div>
      )}
      {queue?.ok && (
        <div style={{ marginBottom: 20 }}>
          <CounterQueueClient
            initial={queue.tickets}
            initialActive={queue.active}
            initialHistory={history?.ok ? history.tickets : []}
          />
        </div>
      )}
      <OrgCounterClient
        initialCode={code}
        pricing={pricing}
        volumetricDivisor={divisor}
        orgName={me.org.name}
        orgLogoUrl={me.org.logoUrl ?? undefined}
      />
    </>
  );
}
