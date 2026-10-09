import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Outfit } from "next/font/google";
import { RouteAnnouncer, SkipLinks, LiveRegion } from "@esoqo/a11y";
import { IconSprite } from "@esoqo/ui";
import { Header, Footer } from "@/components/Chrome";
import "@esoqo/ui/tokens.css";
import "@esoqo/ui/ui.css";
import "./web.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "Esoqo — business records simplified",
    template: "%s · Esoqo",
  },
  description:
    "Registrations, permits, licences and trading records for Kenya’s traders, groups and businesses. Any phone. Dial *483*77#.",
  openGraph: { type: "website", locale: "en_KE", siteName: "Esoqo" },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A2E4D",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexMono.variable} ${outfit.variable}`}
    >
      <body suppressHydrationWarning>
        <IconSprite />
        <SkipLinks />
        <LiveRegion>
          <Header />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <Footer />
        </LiveRegion>
        <RouteAnnouncer />
      </body>
    </html>
  );
}
