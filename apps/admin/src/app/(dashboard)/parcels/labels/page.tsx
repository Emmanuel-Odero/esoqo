import { requireStaff } from '@/lib/session';
import { LiveRefresh } from '@/components/LiveRefresh';
import {
  actionListParcelLabelBatches, actionListParcelLabelRegister,
  actionListParcelLabelStock, actionListParcelOrgs,
} from '../actions';
import { BatchesPanel } from './BatchesPanel';
import { LabelStockPanel } from './LabelStockPanel';
import { RegisterPanel } from './RegisterPanel';

export const dynamic = 'force-dynamic';

/** `?code=` opens straight into that label's attach form — how the
 *  topbar scanner lands here (see ScanBox), and what makes "scan the
 *  label, write down what it's stuck on" a single gesture rather than
 *  a scan followed by hunting for the code in a grid.
 *
 *  `?org=` scopes the whole page to one courier company's own pad.
 *  Stock belongs to whoever it was printed for, and a company must not
 *  be shown — let alone able to reprint — another's codes, so the pool,
 *  the batches and any new mint all move together when this changes.
 *
 *  `?state=` selects the register tab: blank | filled | spent | voided | all.
 *  Blank = empty labels; filled+spent = attached to packages. */
export default async function ParcelLabelsPage(
  { searchParams }: { searchParams: Promise<{ code?: string; org?: string; state?: string }> },
) {
  const ctx = await requireStaff();
  const canGenerate = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.assign');
  const { code, org, state } = await searchParams;
  const registerState = state ?? 'blank';
  const [unused, batches, orgs, register] = await Promise.all([
    actionListParcelLabelStock(org),
    actionListParcelLabelBatches(org),
    actionListParcelOrgs(),
    actionListParcelLabelRegister(registerState, org),
  ]);
  const emptyCount = register.counts['blank'] ?? 0;
  const attachedCount = (register.counts['filled'] ?? 0) + (register.counts['spent'] ?? 0);

  return (
    <>
      <LiveRefresh />
      <div className="head">
        <div>
          <h1>Labels</h1>
          <p>
            Manage every label — Esoqo pool and each courier company&apos;s pads.
            Empty labels ({emptyCount}) are printed stock waiting for a box;
            attached labels ({attachedCount}) already carry item info or a booking.
            Print a batch of PKG-… codes ahead of any booking — stick one on an envelope or a
            box in advance, then hand the code over at booking (or have the sender scan it)
            instead of every physical label having to be printed fresh at checkout time.
          </p>
        </div>
      </div>
      <LabelStockPanel
        canGenerate={canGenerate} unused={unused} openCode={code}
        orgs={orgs} activeOrgId={org}
      />
      <RegisterPanel
        labels={register.labels} counts={register.counts}
        state={registerState} orgId={org}
      />
      <BatchesPanel batches={batches} />
    </>
  );
}
