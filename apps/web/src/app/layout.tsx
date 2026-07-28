import type { Metadata, Viewport } from 'next';
import { RouteAnnouncer, SkipLinks, LiveRegion } from '@esoko/a11y';
import { IconSprite } from '@esoko/ui';
import { Header, Footer } from '@/components/Chrome';
import '@esoko/ui/tokens.css';
import './web.css';

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
    <html lang="en" suppressHydrationWarning>
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
