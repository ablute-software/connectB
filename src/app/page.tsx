// Public landing page, `/` — the fixed one-screen landing of Prompt 935 (02/11/2026): a photograph, a wheel of eight places and a glass card, from the approved mockup (v21). The page itself is shared with
// /investors (src/components/landing-fixed/FixedLandingPage.tsx); this file keeps what is specific to the startups' side: the address and the metadata.
// The previous landing (hero, sections, scroll) is gone from here; its building blocks that other public pages still use stay where they are.
import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import { BRAND_NAME, APP_URL } from '@/lib/brand';
import { FixedLandingPage } from '@/components/landing-fixed/FixedLandingPage';
import { HOME_META } from '@/content/site/pages';

const fraunces = Fraunces({
  subsets: ['latin'], weight: ['500', '600'], style: ['normal', 'italic'],
  variable: '--font-fraunces', display: 'swap',
});

// Prompt 920 §A (Nuno's "sim", 16/10/2026) — the title and description are invisible metadata and change: the title names what the product does
// for both sides and starts with the brand (the name collides with other "Sherlock" companies), the description says it in one sentence.
// The text is in src/content/site/pages.ts, approved in docs/site-copy-920.md §1. Nothing visible on the landing changes except §F.
const TITLE = HOME_META.title;
const DESCRIPTION = HOME_META.description;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: '/' },
  openGraph: {
    title: TITLE, description: DESCRIPTION, url: APP_URL,
    siteName: BRAND_NAME, type: 'website', locale: 'en',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function LandingPage() {
  return <FixedLandingPage mode="startups" fontClass={fraunces.variable} />;
}
