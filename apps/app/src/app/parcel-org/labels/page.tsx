import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * A courier company's own label stock, issued by Esoqo admin.
 *
 * Label ownership is enforced at booking — core-go refuses a code
 * printed for another company, and strict PKG-only means labels the
 * company used to print itself no longer scan: the desk re-prints the
 * Esoqo pad instead. There is deliberately no minting on this screen.
 * What lives here is the register of what was issued (empty vs attached
 * to packages, reprintable with the company's brand), and withdrawing a
 * pad that walked away.
 *
 * There is one scanner in this portal and it lives on the Counter tab:
 * it resolves any PKG- code (whether it's a blank label, a written-on
 * one, or already spent on a parcel), so a sticker someone hands you is
 * checked there. This page is the register — find a code by typing in
 * the filter, open its details, reprint it, or book it.
 *
 * Reprinting needs dispatch; anyone on the company can look. That
 * check here is UX — core-go refuses the underlying routes
 * independently, so a hand-typed URL gets nothing either.
 */
export default async function ParcelOrgLabelsPage(
  { searchParams }: { searchParams: Promise<{ state?: string }> },
) {
  const { state } = await searchParams;
  redirect(`/parcel-org/counter?tab=labels${state ? `&state=${encodeURIComponent(state)}` : ''}`);
}
