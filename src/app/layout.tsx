import type { Metadata } from 'next';
import { Comfortaa, Inter } from 'next/font/google';
import './globals.css';
import { StoreProvider } from '@/lib/store';
import { Shell } from '@/components/shell';
import { ReportProblemWidget } from '@/components/ReportProblemWidget';
import { BottomNavHeightProvider } from '@/lib/bottom-nav-context';
import { ConfirmProvider } from '@/lib/confirm';
import { APP_URL } from '@/lib/brand';
import { HOME_META } from '@/content/site/pages';
import { ChunkErrorRecovery } from '@/components/ChunkErrorRecovery';
import { NewVersionBanner } from '@/components/NewVersionBanner';

// Prompt 920 addendum — the defaults every page without metadata of its own inherits (/login, /signup, the app's screens): they said "Investor
// Relations Management platform that enforces outreach discipline", the positioning before the public site was rewritten. They now carry the
// home's approved title and description (src/content/site/pages.ts), so the product is described once, in the same words, wherever a page does
// not say otherwise. `metadataBase` makes every relative URL a page declares (canonical, the Open Graph image) resolve on the canonical domain
// instead of on whichever deployment URL the platform hands the build.
export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: HOME_META.title,
  description: HOME_META.description,
};

// Prompt 920 addendum (19/10/2026) — the app's two families, self-hosted by next/font. They used to be a <link> to fonts.googleapis.com in
// <head>: a render-blocking stylesheet from a third-party origin (Lighthouse: ~0.9 s of blocking on mobile, on every page, the landing
// included) that also fetched a second copy of the Inter the landing already ships. Nothing here is named by its family any more — the
// 20 places that wrote 'Comfortaa, Inter, sans-serif' read the two variables below, and a test fails if the literal comes back (a
// literal name would silently fall back to the system font, with no error and no failing page).
// `preload: false`: the app's pages are behind a login and are not the LCP of anything; the landing and the public pages declare (and
// preload) their own Inter. Both faces keep their unicode-range subsets, so latin-ext (Polish, Czech, Romanian… investor names) still
// loads on demand, as it did from Google's CSS.
const inter = Inter({
  subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'],
  variable: '--font-inter', display: 'swap', preload: false,
});
const comfortaa = Comfortaa({
  subsets: ['latin'], weight: ['700'],
  variable: '--font-comfortaa', display: 'swap', preload: false,
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${comfortaa.variable}`}>
      <body style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
        {/* Prompt 686 §B — outermost, deliberately: a stale-chunk failure can
            come from any route, including ones Shell/StoreProvider
            themselves might touch, so the recovery boundary must sit above
            everything it might need to catch a failure from. */}
        <ChunkErrorRecovery>
          <StoreProvider>
            <BottomNavHeightProvider>
              <ConfirmProvider>
                <Shell>{children}</Shell>
                <ReportProblemWidget />
                <NewVersionBanner />
              </ConfirmProvider>
            </BottomNavHeightProvider>
          </StoreProvider>
        </ChunkErrorRecovery>
      </body>
    </html>
  );
}
