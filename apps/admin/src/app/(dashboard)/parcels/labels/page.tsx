import { requireStaff } from '@/lib/session';
import { actionListParcelLabelStock } from '../actions';
import { LabelStockPanel } from './LabelStockPanel';

export const dynamic = 'force-dynamic';

export default async function ParcelLabelsPage() {
  const ctx = await requireStaff();
  const canGenerate = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.assign');
  const unused = await actionListParcelLabelStock();

  return (
    <>
      <div className="head">
        <div>
          <h1>Blank parcel labels</h1>
          <p>
            Print a batch of PKG-… codes ahead of any booking — stick one on an envelope or a
            box in advance, then hand the code over at booking (or have the sender scan it)
            instead of every physical label having to be printed fresh at checkout time.
          </p>
        </div>
      </div>
      <LabelStockPanel canGenerate={canGenerate} unused={unused} />
    </>
  );
}
