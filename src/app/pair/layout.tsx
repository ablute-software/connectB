import type { Metadata } from 'next';

// Manifest link scoped to /pair only, not the whole app (a static
// public/manifest.json, not the Next.js per-segment manifest.ts file
// convention — that convention only applies at the app root in Next.js
// 14.2, confirmed by it silently not generating a route when tried
// nested here). The founder/investor workspace was never meant to be
// installable; only this MatchDeal pairing/deck experience is.
export const metadata: Metadata = {
  manifest: '/manifest.json',
};

export default function PairLayout({ children }: { children: React.ReactNode }) {
  return children;
}
