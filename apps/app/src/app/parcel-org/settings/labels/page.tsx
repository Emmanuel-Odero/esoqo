import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listOrgLabelBatches, listOrgLabels } from '../../actions';
import { LabelStockClient } from './LabelStockClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Label stock — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * The company's sticker stock: printing a batch, finding a code,
 * withdrawing a spoiled sheet.
 *
 * This was a tab on Counter, beside the booking form, which put a
 * once-a-month provisioning job next to a once-a-minute selling one.
 * Stock is inventory — a manager decides how much of it to have — so
 * it belongs with the other things a company sets up rather than
 * operates. The booking form still links here, because running out
 * mid-booking is exactly when you need it.
 *
 * Manager-only (parcelorg.write): minting label stock is issuing
 * pre-signed codes. core-go refuses the underlying routes
 * independently, so a hand-typed URL gets nothing either.
 */
export default async function ParcelOrgLabelStockPage(
  { searchParams }: { searchParams: Promise<{ state?: string }> },
) {
  const { state } = await searchParams;
  const labelState = ['all', 'blank', 'filled', 'spent', 'voided'].includes(state ?? '')
    ? state!
    : 'blank';

  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }
  if (!me.capabilities.includes('parcelorg.write')) redirect('/parcel-org');

  const [register, batches] = await Promise.all([
    listOrgLabels('all'), // All of it — the state filter is client-side.
    listOrgLabelBatches(),
  ]);

  return (
    <LabelStockClient
      labels={register.labels}
      counts={register.counts}
      batches={batches}
      initialState={labelState}
      orgName={me.org.name}
      orgLogoUrl={me.org.logoUrl ?? undefined}
    />
  );
}
