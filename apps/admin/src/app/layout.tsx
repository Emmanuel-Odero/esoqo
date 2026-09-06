import type { Metadata, Viewport } from 'next';
import { RouteAnnouncer, SkipLinks, LiveRegion } from '@esoko/a11y';
import { IconSprite } from '@esoko/ui';
import '@esoko/ui/tokens.css';
import '@esoko/ui/ui.css';
import './admin.css';

export const metadata: Metadata = {
  title: { default: 'Operations', template: '%s · Esoko Ops' },
  robots: { index: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0A2E4D' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="admin">
        <IconSprite />
        <SkipLinks />
        <LiveRegion>
          {children}
        </LiveRegion>
        <RouteAnnouncer />
      </body>
    </html>
  );
}
