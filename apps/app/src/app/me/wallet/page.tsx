import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@esoqo/auth';
import { getWalletBalance } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { goFetch, type GoBill } from '@/lib/ticketing';
import { WalletTopUp } from './WalletTopUp';
import { CardsClient } from './CardsClient';
import { BillsClient } from './BillsClient';

export const dynamic = 'force-dynamic';

type Voucher = {
  id: string; label: string; purpose: string; status: string;
  shortCode: string; qrPayload: string; balancePoints: number;
  balanceKes: string;
};

async function loadWalletExtras(token: string) {
  const [v, l, b] = await Promise.all([
    goFetch('/v1/me/vouchers', token).catch(() => ({ vouchers: [] })),
    goFetch('/v1/me/loyalty', token).catch(() => ({ totalPoints: 0, kesEquiv: 0 })),
    goFetch('/v1/me/bills', token).catch(() => ({ bills: [] })),
  ]);
  return {
    vouchers: ((v as { vouchers?: Voucher[] }).vouchers ?? []) as Voucher[],
    loyalty: l as { totalPoints?: number; kesEquiv?: number },
    bills: ((b as { bills?: GoBill[] }).bills ?? []) as GoBill[],
  };
}

/**
 * Wallet — cash, cards, and what's coming due, in one place. Used to be
 * three separate destinations: /me/vouchers (a working feature styled
 * like a debug page), a dormant WALLET ledger account nothing ever
 * showed, and a Bills backend (real, mobile-only) with zero web UI.
 * Money is the more frequent reason somebody opens this bar than
 * tickets are, which is why this took Tickets' old nav slot.
 */
export default async function WalletPage() {
  const ctx = await requireSubject();
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  const [walletBalance, extras] = await Promise.all([
    getWalletBalance(ctx),
    token ? loadWalletExtras(token) : Promise.resolve({ vouchers: [], loyalty: {}, bills: [] }),
  ]);

  return (
    <>
      <div className="mehead">
        <h1>Wallet</h1>
        <p>Your cash, your cards, and what&rsquo;s coming due.</p>
      </div>

      <section className="balance-hero">
        <span className="k">Your balance</span>
        <span className="v mono">KES {walletBalance.toLocaleString('en-KE')}</span>
        <div style={{ marginTop: 12 }}>
          <WalletTopUp />
        </div>
      </section>

      <BillsClient initial={extras.bills} />
      <CardsClient initial={extras.vouchers} loyalty={extras.loyalty} />
    </>
  );
}
