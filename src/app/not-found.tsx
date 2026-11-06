// Prompt 933 (06/11/2026) — the page for an address that matches nothing, in place of Next's own ("404 | This page could not be found", no brand, no way on). Next answers it with HTTP 404 (nothing here
// overrides that: it is the status of the unmatched route), and a visitor with no session can finally reach it, because the middleware no longer sends an address nothing answers to /login (src/lib/route-zones.ts).
//
// It is also what a notFound() raised inside a page renders. For an address that matches no route, Next draws this file as the page of the segment '/_not-found' under the root layout, and the Shell
// (src/components/shell.tsx) puts the public header and footer around it; inside a page of its own it is just the card, in whatever frame that page has. The title says what the tab is, and Next marks a
// not-found response noindex by itself.
import type { Metadata } from 'next';
import { NotFoundCard } from '@/components/site/NotFoundCard';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Page not found — ${BRAND_NAME}`,
};

export default function NotFound() {
  return <NotFoundCard />;
}
