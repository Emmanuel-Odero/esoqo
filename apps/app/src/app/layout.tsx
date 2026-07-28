import type { Metadata, Viewport } from 'next';
import { RouteAnnouncer, SkipLinks, LiveRegion } from '@esoko/a11y';
import { IconSprite } from '@esoko/ui';
import '@esoko/ui/tokens.css';
import './app.css';

export const metadata: Metadata = {
  title: { default: 'Esoko', template: '%s · Esoko' },
  description:
    'Registrations, permits, licences and trading records for Kenya\u2019s traders, groups and businesses.',
  robots: { index: false }, // the app surface is not for search engines
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never maximumScale — capping zoom is a WCAG 1.4.4 failure and this
  // product is used in bright sun by people with reading glasses.
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
