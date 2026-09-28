'use client';
import { useState } from 'react';
import { Icon } from '@esoqo/ui';
import type { GoBill } from '@/lib/ticketing';
import { CardsClient } from './CardsClient';
import { BillsClient } from './BillsClient';

type Voucher = {
  id: string; label: string; purpose: string; status: string;
  shortCode: string; qrPayload: string; balancePoints: number;
  balanceKes: string;
};

export function WalletShell({
  vouchers,
  loyalty,
  bills,
}: {
  vouchers: Voucher[];
  loyalty: { totalPoints?: number; kesEquiv?: number };
  bills: GoBill[];
}) {
  const [tab, setTab] = useState<'cards' | 'bills'>('cards');
  const dueSoon = bills.filter((b) => b.DueSoon || b.Overdue).length;
  return (
    <>
      <div className="wallet-tabs" role="tablist" aria-label="Wallet sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'cards'}
          className="wallet-tab"
          onClick={() => setTab('cards')}
        >
          <Icon name="tag" size={16} /> Cards · {vouchers.length + 1}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'bills'}
          className="wallet-tab"
          onClick={() => setTab('bills')}
        >
          <Icon name="calendar" size={16} /> Bills
          {dueSoon > 0 ? <span className="badge b-warn" style={{ marginLeft: 2 }}>{dueSoon} due</span> : ` · ${bills.length}`}
        </button>
      </div>

      {tab === 'cards' ? (
        <CardsClient initial={vouchers} loyalty={loyalty} />
      ) : (
        <BillsClient initial={bills} />
      )}
    </>
  );
}
