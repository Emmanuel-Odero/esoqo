import type { Metadata, Viewport } from 'next';
import { RouteAnnouncer, SkipLinks, LiveRegion } from '@esoko/a11y';
import { IconSprite } from '@esoko/ui';
import '@esoko/ui/tokens.css';
import '@esoko/ui/ui.css';
import './jamii.css';

export const metadata: Metadata = {
  title: { default: 'Our Jamii · CECF Community Pages', template: '%s · Our Jamii' },
  description: 'A mini-site and crowdfunding page for community impact groups, from CECF.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#16233B',
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
