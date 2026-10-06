import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listOpenRuns } from './actions';
import { ScannerConsole } from './ScannerConsole';
import './scanner.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Scanner — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * The scanner — one page whose only job is "a box is in front of me".
 *
 * It opens ready: the entry field is focused, the camera button is one
 * tap away, and a scanner gun can fire straight into it without anyone
 * choosing a mode first. There are no tabs, because a tab is a question
 * ("which kind of code is this?") the person holding the box should
 * never have to answer — the code itself says what it is, and its state
 * says what can be done to it.
 *
 * That is the whole design rule here: THE PARCEL'S STATE PICKS THE
 * BUTTONS. A blank label offers the shipping details. A box the sender
 * is bringing in offers receiving. A box on our shelf offers a run to
 * load it onto. A box that is moving asks the one question no server
 * can answer — is this its last stop? — and then offers either a
 * transit scan or the hand-over. Nothing else is ever on screen.
 *
 * Capability-gated to anyone who can carry or dispatch. core-go refuses
 * each underlying call independently (see ADR-0003), so this gate is
 * about not drawing dead buttons, not about security.
 */
export default async function ParcelOrgScanPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  const canCarry = me.capabilities.includes('parcelorg.carry');
  const canDispatch = me.capabilities.includes('parcelorg.dispatch');
  const canIntake = me.capabilities.includes('parcelorg.intake');
  const canArrival = me.capabilities.includes('parcelorg.arrival');
  if (!canCarry && !canDispatch && !canIntake && !canArrival) redirect('/parcel-org');

  // Fetched here so the page is useful on first paint — a clerk who has
  // to wait for a dropdown to fill after scanning has been given a
  // loading spinner in place of a decision.
  const runs = canCarry || canDispatch ? await listOpenRuns() : [];

  return (
    <>
      {/* Compact on purpose — the scan box is the hero and every pixel
          above it pushes the thing the page exists for further down the
          screen. It is a real h1 rather than nothing at all because a
          page with no heading gives a screen-reader user no way to tell
          where they have landed, and no way to jump to the content. */}
      <div className="scan-head">
        <p className="kicker">{me.org.name}</p>
        <h1>Scanner</h1>
        <p>
          Scan any label or parcel code. You&rsquo;ll be shown what it is and only the
          things you can actually do with it.
        </p>
      </div>
      <ScannerConsole
        orgName={me.org.name}
        orgLogoUrl={me.org.logoUrl ?? undefined}
        initialRuns={runs}
        canCarry={canCarry}
        canDispatch={canDispatch}
        canIntake={canIntake}
        canArrival={canArrival}
        canOverride={me.capabilities.includes('parcels.override')}
        // Undefined means a core-go that predates the field — assume
        // capable, which is the behaviour that existed before it.
        custodyCapable={me.custodyCapable !== false}
      />
    </>
  );
}
