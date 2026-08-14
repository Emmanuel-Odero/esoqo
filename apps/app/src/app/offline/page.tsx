import type { Metadata } from 'next';
import { Icon, Logo } from '@esoko/ui';

export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false },
};

/**
 * Served by the service worker whenever a navigation fails while offline.
 * Deliberately tiny and dependency-light — this page, its icon and its
 * CSS are precached at install, so it must load with zero network.
 */
export default function OfflinePage() {
  return (
    <div className="offline-page">
      <Logo />
      <span className="ico">
        <Icon name="wifi-off" size={26} />
      </span>
      <h1>You are offline</h1>
      <p>
        The last pages you visited are still here — reopen them and nothing is lost. What changed
        on Esoko while you were away will come back when the connection does.
      </p>
      <p className="hint" style={{ margin: '4px 0 0' }}>
        From any number you have registered, you can also dial{' '}
        <strong style={{ color: 'var(--navy)' }}>*483*77#</strong> and your record is available
        there too.
      </p>
    </div>
  );
}