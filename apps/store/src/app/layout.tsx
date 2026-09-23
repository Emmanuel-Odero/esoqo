import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Outfit } from "next/font/google";
import { RouteAnnouncer, SkipLinks, LiveRegion } from "@esoqo/a11y";
import { IconSprite } from "@esoqo/ui";
import "@esoqo/ui/tokens.css";
import "@esoqo/ui/ui.css";
import "./store.css";

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
  title: { default: "Esoqo Store", template: "%s · Esoqo Store" },
  description:
    "Open a store, sell online and in person, and get paid the way your customers already pay.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Never maximumScale — capping zoom is a WCAG 1.4.4 failure.
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
      <body>
        <IconSprite />
        <SkipLinks />
        <LiveRegion>
          <main id="main" tabIndex={-1}>
            {children}
          </main>
        </LiveRegion>
        <RouteAnnouncer />
      </body>
    </html>
  );
}
