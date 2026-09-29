import { Icon, type IconName } from '@esoqo/ui';
import type { WalletActivityItem } from '@esoqo/db';

const KIND_META: Record<WalletActivityItem['kind'], { icon: IconName; title: (a: WalletActivityItem) => string; incoming: boolean }> = {
  TOPUP: { icon: 'plus-circle', title: (a) => `Top-up from ${a.counterparty}`, incoming: true },
  WITHDRAWAL: { icon: 'download', title: () => 'Withdrawal to M-Pesa', incoming: false },
  TRANSFER_SENT: { icon: 'send', title: (a) => `Sent to ${a.counterparty}`, incoming: false },
  TRANSFER_RECEIVED: { icon: 'inbox', title: (a) => `Received from ${a.counterparty}`, incoming: true },
};

function statusBadge(status: string): { cls: string; text: string } | null {
  if (status === 'PENDING') return { cls: 'b-warn', text: 'Pending' };
  if (status === 'FAILED') return { cls: 'b-bad', text: 'Failed' };
  return null; // CONFIRMED is the normal case — no badge needed for it
}

/** Every WALLET-touching movement in one list — top-ups, withdrawals, and
 *  transfers sent or received (see getWalletActivity in
 *  dal/subject.ts). Pure display, server-rendered: nothing here is
 *  actionable, so there is no reason for a client component. */
export function WalletActivity({ items }: { items: WalletActivityItem[] }) {
  return (
    <section className="mcard mcard--premium">
      <h2 style={{ marginBottom: 6 }}><Icon name="clock" size={18} />Activity</h2>
      <p className="mcard-lede" style={{ margin: 0 }}>Top-ups, withdrawals and transfers — newest first.</p>

      {items.length === 0 ? (
        <div className="mempty" style={{ marginTop: 12 }}>
          <span className="ico"><Icon name="clock" size={22} /></span>
          <h3 style={{ fontSize: '.98rem', margin: '0 0 6px', fontWeight: 700 }}>No activity yet</h3>
          <p style={{ margin: 0, fontSize: '.88rem', maxWidth: 360 }}>
            Top up, send to a handle, or withdraw — everything that moves your balance shows up here.
          </p>
        </div>
      ) : (
        <ul className="papers" style={{ marginTop: 14 }}>
          {items.map((a) => {
            const meta = KIND_META[a.kind];
            const badge = statusBadge(a.status);
            const failed = a.status === 'FAILED';
            return (
              <li className="paper" key={`${a.kind}-${a.id}`}>
                <span className={`ps ${failed ? 'gap' : meta.incoming ? 'ok' : 'soon'}`} aria-hidden="true">
                  <Icon name={meta.icon} size={16} />
                </span>
                <span className="pt">
                  <span className="t">{meta.title(a)}</span>
                  <span className="s">
                    {new Date(a.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                    {a.feeKes > 0 ? ` · KES ${a.feeKes.toLocaleString('en-KE')} fee` : ''}
                    {a.note ? ` · "${a.note}"` : ''}
                  </span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span className="mono" style={{ fontWeight: 700, fontSize: '.86rem', color: failed ? 'var(--tx-3)' : meta.incoming ? 'var(--green)' : 'var(--tx-1)' }}>
                    {meta.incoming ? '+' : '−'}KES {a.amountKes.toLocaleString('en-KE')}
                  </span>
                  {badge && <span className={`badge ${badge.cls}`}>{badge.text}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
