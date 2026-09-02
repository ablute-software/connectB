// Prompt 537 §4.3 — the guest preview must never be indexed.
//
// The page itself is a client component and so cannot export `metadata`;
// this server-component layout is the only place in the App Router where
// that tag can be declared for this route. It renders
// <meta name="robots" content="noindex, nofollow"> into the document head.
//
// Three independent layers, on purpose, because each covers a different
// failure: robots.ts's `disallow: '/guest/'` is a request a crawler may
// ignore; the X-Robots-Tag header on /api/guest/[token] travels with the
// API response; and this tag covers the HTML page a crawler would actually
// render if it ever reached one of these URLs. A guest link carries an
// invited person's email address and a startup's document names — indexing
// one would make both permanently findable.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
