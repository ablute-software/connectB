// Public landing page, `/investors` — the investors' side of the fixed one-screen landing (Prompt 935, 02/11/2026). The page is shared with `/` (src/components/landing-fixed/FixedLandingPage.tsx); this file keeps
// what is specific to this side: its own address and metadata, so each side stays a shareable URL. The call to action (Claim your profile -> /claim) is in src/content/site/landing-fixed.ts.
import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import { BRAND_NAME, APP_URL } from '@/lib/brand';
import { FixedLandingPage } from '@/components/landing-fixed/FixedLandingPage';

const fraunces = Fraunces({
  subsets: ['latin'], weight: ['500', '600'], style: ['normal', 'italic'],
  variable: '--font-fraunces', display: 'swap',
});

const TITLE = `${BRAND_NAME} for Investors — qualified deal flow, verified access`;
const DESCRIPTION = `${BRAND_NAME} continuously analyses startups against your investment mandate and delivers only the opportunities that deserve your team's attention — qualified, explained, and ready for a decision.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: '/investors' },
  openGraph: {
    title: TITLE, description: DESCRIPTION, url: `${APP_URL}/investors`,
    siteName: BRAND_NAME, type: 'website', locale: 'en',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function InvestorLandingPage() {
  return <FixedLandingPage mode="investors" fontClass={fraunces.variable} />;
}
