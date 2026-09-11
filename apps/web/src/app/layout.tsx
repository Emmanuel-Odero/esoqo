import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Outfit } from 'next/font/google';
import { RouteAnnouncer, SkipLinks, LiveRegion } from '@esoko/a11y';
import { IconSprite } from '@esoko/ui';
import { Header, Footer } from '@/components/Chrome';
import '@esoko/ui/tokens.css';
import '@esoko/ui/ui.css';
import './web.css';

const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-plex-sans', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-mono', display: 'swap' });
const outfit = Outfit({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-outfit', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'),
  title: { default: 'Esoko — business records simplified', template: '%s · Esoko' },
  description:
    'Registrations, permits, licences and trading records for Kenya’s traders, groups and businesses. Any phone. Dial *483*77#.',
  openGraph: { type: 'website', locale: 'en_KE', siteName: 'Esoko' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0A2E4D' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable} ${outfit.variable}`}>
      <body>
        <IconSprite />
        <SkipLinks />
        <LiveRegion>
          <Header />
          <main id="main" tabIndex={-1}>{children}</main>
          <Footer />
        </LiveRegion>
        <RouteAnnouncer />
      </body>
    </html>
  );
}
