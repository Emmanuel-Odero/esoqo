import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@esoqo/auth';
import { getWalletBalance } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { goFetch, type GoBill } from '@/lib/ticketing';
import { Icon } from '@esoqo/ui';
import { WalletTopUp } from './WalletTopUp';
import { WalletShell } from './WalletShell';
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
 * Wallet — priority from first glance:
 * 1. Mast: where you are.
 * 2. Balance: the one number people open for (KES + top up).
 * 3. Bento: desktop — Cards + Bills side-by-side (no hidden tab).
 *           mobile  — tabs (cards | bills) to avoid long scroll.
 * Every pixel carries money or an action — no hero copy competing with balance.
 */
export default async function WalletPage() {
  const ctx = await requireSubject();
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  const [walletBalance, extras] = await Promise.all([
    getWalletBalance(ctx),
    token ? loadWalletExtras(token) : Promise.resolve({ vouchers: [], loyalty: {}, bills: [] }),
  ]);

  const cardsCount = extras.vouchers.length;
  const loyaltyPts = (extras.loyalty as { totalPoints?: number }).totalPoints ?? 0;
  const billsDue = extras.bills.filter((b) => b.DueSoon || b.Overdue).length;

  return (
    <>
      <header className="me-mast" aria-label="Wallet">
        <div className="me-mast-copy">
          <p className="kicker">Wallet</p>
          <h1>Wallet</h1>
          <p className="me-mast-lead">Cash, vouchers, loyalty and bills — one place, plain language.</p>
        </div>
        <div style={{ alignSelf: 'center', display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-hidden="true">
          <span className="badge b-mute">{cardsCount} {cardsCount === 1 ? 'card' : 'cards'} · {loyaltyPts} pts</span>
          <span className={`badge ${billsDue ? 'b-warn' : 'b-mute'}`}>{extras.bills.length} {extras.bills.length === 1 ? 'bill' : 'bills'}{billsDue ? ` · ${billsDue} due` : ''}</span>
        </div>
      </header>

      {/* Mobile: single column, balance then tabs. Desktop: a grid where
          Bills is a tall right rail running from the balance card's top
          down to the bottom of Cards — not a short box trailing beside a
          taller one. */}
      <div className="wallet-layout">
        <section className="balance-hero balance-hero--compact" aria-label="Your balance">
          <div>
            <span className="k">Available</span>
            <span className="v mono">KES {walletBalance.toLocaleString('en-KE')}</span>
            <span className="h">Vouchers spend anywhere; loyalty earns 10% back. Bills are reminders only.</span>
          </div>
          <div className="balance-hero-side">
            <div className="balance-actions">
              <WalletTopUp />
            </div>
            <div className="balance-meta" aria-label="Wallet overview">
              <span><Icon name="tag" size={12} aria-hidden="true" />{cardsCount} {cardsCount === 1 ? 'card' : 'cards'} · {loyaltyPts} pts</span>
              <span><Icon name="calendar" size={12} aria-hidden="true" />{extras.bills.length} {extras.bills.length === 1 ? 'bill' : 'bills'}{billsDue ? ` · ${billsDue} due soon` : ''}</span>
            </div>
          </div>
        </section>

        <div className="wallet-mobile">
          <WalletShell vouchers={extras.vouchers} loyalty={extras.loyalty} bills={extras.bills} />
        </div>

        <div className="wallet-desktop-cards" aria-label="Cards">
          <CardsClient initial={extras.vouchers} loyalty={extras.loyalty} />
        </div>
        <div className="wallet-desktop-bills" aria-label="Bills">
          <BillsClient initial={extras.bills} />
        </div>
      </div>

      <p className="hint" style={{ marginTop: 12, fontSize: '.82rem' }}>
        <Icon name="alert-circle" size={13} aria-hidden="true" /> Bills don&apos;t auto-pay — we remind, you pay the biller.
      </p>
    </>
  );
}
