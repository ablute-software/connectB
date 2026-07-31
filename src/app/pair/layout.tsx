import type { Metadata, Viewport } from 'next';

// Manifest link scoped to /pair only, not the whole app (a static
// public/manifest.json, not the Next.js per-segment manifest.ts file
// convention — that convention only applies at the app root in Next.js
// 14.2, confirmed by it silently not generating a route when tried
// nested here). The founder/investor workspace was never meant to be
// installable; only this MatchDeal pairing/deck experience is.
export const metadata: Metadata = {
  title: 'MatchDeal — Sherlock Deal',
  manifest: '/manifest.json',
};

// MD-08: this route is a full-bleed phone surface, not a document. Pinning
// the scale stops iOS Safari zooming the viewport when a control is tapped
// mid-swipe, and viewport-fit=cover is what makes the env(safe-area-inset-*)
// padding in page.tsx mean anything on a notched device. themeColor here
// (not the CRM teal) is what tints the status bar once it's installed.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0B1220',
};

export default function PairLayout({ children }: { children: React.ReactNode }) {
  return children;
}
