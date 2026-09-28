import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@esoqo/auth';
import { getWalletBalance } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { goFetch, type GoBill } from '@/lib/ticketing';
import { Icon } from '@esoqo/ui';
import { WalletTopUp } from './WalletTopUp';
import { WalletShell } from './WalletShell';

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

  const cardsCount = extras.vouchers.length;
  const loyaltyPts = (extras.loyalty as { totalPoints?: number }).totalPoints ?? 0;
  const loyaltyKes = (extras.loyalty as { kesEquiv?: number }).kesEquiv ?? 0;
  const billsDue = extras.bills.filter((b) => b.DueSoon || b.Overdue).length;

  return (
    <>
      <header className="hero" style={{ padding: '4px 0 14px' }}>
        <p className="kicker">Wallet</p>
        <h1>Your money</h1>
        <p className="lead">Cash, cards and what&apos;s coming due — each in its own dedicated space.</p>
      </header>

      <section className="balance-hero" aria-label="Your balance">
        <span className="k">Available to spend</span>
        <span className="v mono">KES {walletBalance.toLocaleString('en-KE')}</span>
        <span className="h">Add from M-Pesa anytime. Vouchers and loyalty live just below.</span>
        <div className="balance-actions">
          <WalletTopUp />
        </div>
        <div className="balance-meta" aria-label="Wallet overview">
          <span><Icon name="tag" size={12} />{cardsCount} card{cardsCount === 1 ? '' : 's'} · {loyaltyPts} pts</span>
          <span><Icon name="calendar" size={12} />{extras.bills.length} bill{extras.bills.length === 1 ? '' : 's'}{billsDue ? ` · ${billsDue} due soon` : ''}</span>
          <span><Icon name="coins" size={12} />Instant M-Pesa top-up</span>
        </div>
      </section>

        <div className="premium-stats" aria-label="Wallet at a glance">
        <div className="pstat">
          <span className="pstat-k">Cards</span>
          <span className="pstat-v">{cardsCount + 1}</span>
          <span className="pstat-h">Vouchers + loyalty</span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Bills tracked</span>
          <span className="pstat-v">{extras.bills.length}</span>
          <span className="pstat-h">{billsDue ? `${billsDue} due soon` : 'All caught up'}</span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Loyalty</span>
          <span className="pstat-v">{loyaltyPts} pts</span>
          <span className="pstat-h">≈ KES {loyaltyKes}</span>
        </div>
      </div>

      <WalletShell vouchers={extras.vouchers} loyalty={extras.loyalty} bills={extras.bills} />

      <p className="hint" style={{ marginTop: 12, fontSize: '.82rem' }}>
        <Icon name="alert-circle" size={13} /> Wallet and vouchers are separate balances. A bill is a reminder — Esoqo never pays a biller for you.
      </p>
    </>
  );
}
