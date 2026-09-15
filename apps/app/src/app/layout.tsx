import type { Metadata, Viewport } from 'next';
import {
  Atkinson_Hyperlegible,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Outfit,
} from 'next/font/google';
import { RouteAnnouncer, SkipLinks, LiveRegion } from '@esoqo/a11y';
import { IconSprite } from '@esoqo/ui';
import '@esoqo/ui/tokens.css';
import '@esoqo/ui/ui.css';
import './app.css';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { ConnectivityBanner } from '@/components/ConnectivityBanner';

/**
 * One font per role, loaded once and reused everywhere:
 *   Plex Sans  → body (legible, compact, built for long-form UI)
 *   Outfit     → display/headlines (friendly, round, high x-height)
 *   Plex Mono  → money, codes, identifiers (tabular numerals)
 *   Atkinson   → the optional "high legibility" accessibility setting
 *
 * The CSS variables below are re-declared in app.css so the user-adjustable
 * `data-font="legible"` preference (which swaps --font-body) still wins.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
});

const atkinson = Atkinson_Hyperlegible({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-atkinson',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Esoqo', template: '%s · Esoqo' },
  description:
    'Registrations, permits, licences and trading records for Kenya\u2019s traders, groups and businesses.',
  robots: { index: false }, // the app surface is not for search engines
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Esoqo',
  },
  formatDetection: {
    telephone: false, // phone numbers are data here, not dial links
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never maximumScale — capping zoom is a WCAG 1.4.4 failure and this
  // product is used in bright sun by people with reading glasses.
  themeColor: '#0A2E4D',
  viewportFit: 'cover', // extend under notches so the safe-area utilities matter
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexMono.variable} ${outfit.variable} ${atkinson.variable}`}
    >
      <body>
        <IconSprite />
        <SkipLinks />
        <ConnectivityBanner />
        <LiveRegion>
          <main id="main" tabIndex={-1}>{children}</main>
        </LiveRegion>
        <RouteAnnouncer />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
