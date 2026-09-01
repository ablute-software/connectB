import type { Metadata } from 'next';
import './globals.css';
import { StoreProvider } from '@/lib/store';
import { Shell } from '@/components/shell';
import { ReportProblemWidget } from '@/components/ReportProblemWidget';
import { BottomNavHeightProvider } from '@/lib/bottom-nav-context';
import { ConfirmProvider } from '@/lib/confirm';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `${BRAND_NAME} — Investor Relations`,
  description: `${BRAND_NAME} — the Investor Relations Management platform that enforces outreach discipline. Founders, investors and the platform team in one place.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Comfortaa:wght@700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* Prompt 520 §4 — Material Symbols was loaded ONLY by
            src/app/network/layout.tsx, deliberately "scoped to /network".
            But NetworkPageContent is reused by the Investor Workspace shell,
            which mounts under /portal — and there is no layout under
            src/app/portal, so it inherited this root layout, which did not
            load the font. The <span className="material-symbols-outlined">
            then rendered its ligature name as literal text: investors saw
            "dynamic_feed", "travel_explore", "diversity_3" instead of icons.
            Promoted here (as /network/layout.tsx's own comment already
            suggested) so both routes get it from one place. */}
        {/* display=block, not the `optional` eslint suggests: this is an ICON
            font whose glyphs are selected by ligature name. Any display mode
            that can render text before (or instead of) the font shows the raw
            ligature — "dynamic_feed", "travel_explore" — which is precisely
            the bug being fixed here. `block` keeps the glyph invisible until
            the font is there; `optional` could leave it never loading at all. */}
        {/* eslint-disable-next-line @next/next/google-font-display -- see above: the
            rule targets text fonts, where `block` risks invisible text. For an
            icon font the failure mode is the opposite and worse. */}
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <StoreProvider>
          <BottomNavHeightProvider>
            <ConfirmProvider>
              <Shell>{children}</Shell>
              <ReportProblemWidget />
            </ConfirmProvider>
          </BottomNavHeightProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
