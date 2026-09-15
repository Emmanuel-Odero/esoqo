import { requireStaff } from '@/lib/session';
import { actionListParcelPricing } from '../actions';
import { CounterForm } from './CounterForm';

export const dynamic = 'force-dynamic';

/**
 * The counter: taking a parcel in over a desk.
 *
 * `?code=` lands here pre-loaded — from the topbar scanner, or from the
 * label register's "Resume" on a label a handler already filled in
 * somewhere out in the field.
 *
 * The volumetric divisor is read here rather than hard-coded in the
 * form so the number the clerk watches move is the same one core-go
 * will charge on. It's a commercial setting (5000 air, 6000 road), and
 * two copies of it drifting apart would mean the quote on screen and
 * the price on the receipt disagreeing.
 */
export default async function ParcelCounterPage(
  { searchParams }: { searchParams: Promise<{ code?: string }> },
) {
  await requireStaff();
  const [pricing, { code }] = await Promise.all([actionListParcelPricing(), searchParams]);
  const divisor = Number(process.env.PARCEL_VOLUMETRIC_DIVISOR) || 5000;

  return (
    <>
      <div className="head">
        <div>
          <h1>Counter</h1>
          <p>
            Scan a label, or start from blank. Stop wherever the moment allows — a record saved
            against a label is resumable by whoever handles the box next, and only becomes a
            booking when there is a sender, a receiver and a route.
          </p>
        </div>
      </div>
      <CounterForm initialCode={code} pricing={pricing} volumetricDivisor={divisor} />
    </>
  );
}
