import type { Metadata, Viewport } from 'next';
import { RouteAnnouncer, SkipLinks, LiveRegion } from '@esoko/a11y';
import { IconSprite } from '@esoko/ui';
import '@esoko/ui/tokens.css';
import '@esoko/ui/ui.css';
import './store.css';

export const metadata: Metadata = {
  title: { default: 'Esoko Store', template: '%s · Esoko Store' },
  description: 'Open a store, sell online and in person, and get paid the way your customers already pay.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never maximumScale — capping zoom is a WCAG 1.4.4 failure.
  themeColor: '#0A2E4D',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <IconSprite />
        <SkipLinks />
        <LiveRegion>
          <main id="main" tabIndex={-1}>{children}</main>
        </LiveRegion>
        <RouteAnnouncer />
      </body>
    </html>
  );
}
