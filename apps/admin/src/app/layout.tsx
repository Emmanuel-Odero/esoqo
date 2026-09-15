import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Outfit } from 'next/font/google';
import { RouteAnnouncer, SkipLinks, LiveRegion } from '@esoqo/a11y';
import { IconSprite } from '@esoqo/ui';
import '@esoqo/ui/tokens.css';
import '@esoqo/ui/ui.css';
import './admin.css';

const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-plex-sans', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-mono', display: 'swap' });
const outfit = Outfit({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-outfit', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Operations', template: '%s · Esoqo Ops' },
  robots: { index: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0A2E4D' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable} ${outfit.variable}`}>
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
