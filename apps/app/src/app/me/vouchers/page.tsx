import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@esoqo/auth';
import { goFetch } from '@/lib/ticketing';
import { VoucherClient } from './VoucherClient';

export const dynamic = 'force-dynamic';

type Voucher = {
  id: string; label: string; purpose: string; status: string;
  shortCode: string; qrPayload: string; balancePoints: number;
  // Decimal string from core-go — see @esoqo/domain's money module.
  balanceKes: string;
};

async function load(token: string) {
  const [v, l] = await Promise.all([
    goFetch('/v1/me/vouchers', token).catch(() => ({ vouchers: [] })),
    goFetch('/v1/me/loyalty', token).catch(() => ({ totalPoints: 0, kesEquiv: 0 })),
  ]);
  return {
    vouchers: ((v as { vouchers?: Voucher[] }).vouchers ?? []) as Voucher[],
    loyalty: l as { totalPoints?: number; kesEquiv?: number; partyPoints?: number },
  };
}

export default async function MeVouchers() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  const { vouchers, loyalty } = token ? await load(token) : { vouchers: [], loyalty: {} };
  return (
    <>
      <div className="mehead">
        <h1>Vouchers</h1>
        <p>Purpose-locked cards — 10 pts = KES 1. Every confirmed spend earns 10% back as loyalty.</p>
      </div>
      <div className="mcard">
        <h2>Loyalty</h2>
        <p>{loyalty.totalPoints ?? 0} pts ≈ KES {loyalty.kesEquiv ?? 0}</p>
      </div>
      <VoucherClient initial={vouchers} />
    </>
  );
}
