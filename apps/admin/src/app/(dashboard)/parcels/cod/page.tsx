import { Icon } from '@esoqo/ui';
import { formatKES, subCents, sumCents, toCentsOrZero } from '@esoqo/domain';
import { requireStaff } from '@/lib/session';
import { actionGetCodPolicy, actionListSellersOwedCod } from '../actions';
import { CodConsole } from './CodConsole';

export const dynamic = 'force-dynamic';

/**
 * The money desk for cash on delivery.
 *
 * Two jobs, in the order they happen: count riders' cash in, then pay
 * sellers out. They're on one page because they're one chain — you
 * cannot settle a seller against money no rider has handed over, and a
 * console that let you try would eventually let you do it.
 */
export default async function ParcelCodPage() {
  const ctx = await requireStaff();
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.edit');
  // Deliberately the same capability that already governs refunds:
  // taking custody of a bag of cash is the same kind of trust, and a
  // capability set that grows a string per money movement stops being
  // something anyone can audit.
  const canHandleMoney = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.refund');

  const [policy, sellers] = await Promise.all([
    actionGetCodPolicy(),
    actionListSellersOwedCod(),
  ]);

  const owedTotal = sumCents(sellers.map((s) => toCentsOrZero(s.goodsKes)));
  const readyTotal = sumCents(sellers.map((s) => toCentsOrZero(s.readyKes)));
  const inPockets = subCents(owedTotal, readyTotal);

  return (
    <>
      <div className="head">
        <div>
          <h1>Cash on delivery</h1>
          <p>
            Money collected at doorsteps on sellers&apos; behalf. Count a rider&apos;s cash in
            first — only what&apos;s actually been handed over can be paid out.
          </p>
        </div>
      </div>

      {!policy.enabled && (
        <div className="chain" style={{ background: 'var(--amber-t)', border: '1px solid #E8D2A0', color: 'var(--amber)', marginBottom: 16 }}>
          <Icon name="alert-triangle" size={18} />
          <span>
            Cash on delivery is switched off, so no new parcels can be booked with it. Anything
            already collected still settles normally below.
          </span>
        </div>
      )}

      <div className="kpis" style={{ marginBottom: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        <div className={`kpi ${inPockets > 0 ? 'a' : ''}`}>
          <span className="l">In riders&apos; pockets</span>
          <span className="n" style={{ color: inPockets > 0 ? 'var(--amber)' : undefined }}>
            KES {formatKES(inPockets)}
          </span>
          <span className="sub">Collected but not yet handed in</span>
        </div>
        <div className="kpi g">
          <span className="l">Ready to pay out</span>
          <span className="n">KES {formatKES(readyTotal)}</span>
          <span className="sub">Handed in, owed to sellers</span>
        </div>
        <div className="kpi">
          <span className="l">Sellers waiting</span>
          <span className="n">{sellers.length}</span>
          <span className="sub">With money owed to them</span>
        </div>
      </div>

      <CodConsole
        policy={policy}
        sellers={sellers}
        canEdit={canEdit}
        canHandleMoney={canHandleMoney}
      />
    </>
  );
}
