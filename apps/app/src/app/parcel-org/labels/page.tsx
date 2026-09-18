import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listOrgLabelBatches, listOrgLabels } from '../actions';
import { OrgLabelsClient } from './OrgLabelsClient';
import { LabelLookup } from './LabelLookup';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your labels — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * A courier company's own label stock, issued by Esoqo admin.
 *
 * Label ownership is enforced at booking — core-go refuses a code
 * printed for another company — and pads reach a company only through
 * Esoqo: there is deliberately no minting on this screen. What lives
 * here is the register of what was issued (reprintable with the
 * company's brand), lookup, and withdrawing a pad that walked away.
 *
 * Reprinting needs dispatch; anyone on the company can look. That
 * check here is UX — core-go refuses the underlying routes
 * independently, so a hand-typed URL gets nothing either.
 */
export default async function ParcelOrgLabelsPage(
  { searchParams }: { searchParams: Promise<{ state?: string }> },
) {
  const { state } = await searchParams;
  const activeState = state ?? 'blank';

  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  let register: Awaited<ReturnType<typeof listOrgLabels>>;
  let batches: Awaited<ReturnType<typeof listOrgLabelBatches>>;
  try {
    [me, register, batches] = await Promise.all([
      getParcelOrgMe(),
      listOrgLabels(activeState),
      listOrgLabelBatches(),
    ]);
  } catch (e) {
    // An expired shift session lands at the company's own door, not
    // /signin — a rider doesn't know their employer's slug, and the
    // customer sign-in is the wrong door entirely.
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Your labels</h1>
          <p>
            The pads Esoqo issued to {me.org.name} — stick them on boxes as they come in.
            They are yours — no other company can book a parcel against them.
          </p>
        </div>
      </div>
      <LabelLookup canManage={me.capabilities.includes('parcelorg.dispatch')} />
      <OrgLabelsClient
        labels={register.labels} counts={register.counts} batches={batches}
        state={activeState}
        canManage={me.capabilities.includes('parcelorg.dispatch')}
        orgName={me.org.name}
      />
    </>
  );
}
