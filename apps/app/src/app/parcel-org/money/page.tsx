import { redirect } from 'next/navigation';

/**
 * Money moved to Overview.
 *
 * The tab answered only "what does the shift owe"; the same figures and
 * the same reconciliation panels now live under Overview, where they sit
 * beneath the rest of the business. Kept as a redirect rather than
 * deleted so bookmarks and the odd hand-typed or emailed URL still land
 * somewhere real.
 */
export default function ParcelOrgMoneyPage() {
  redirect('/parcel-org/overview');
}
