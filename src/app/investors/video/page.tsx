// Prompt 688 Bloco B — public destination for the video's own derivatives:
// the LinkedIn post links here, and the email GIF (public/video/
// investors-wave-10s.gif) points here too, since neither a LinkedIn post nor
// an email client can embed an autoplaying <video> directly. Deliberately a
// separate, minimal page rather than reusing the /investors hero: a visitor
// who followed a link specifically to watch the video shouldn't have to load
// the entire marketing page around it, and LinkedIn/email link-preview
// crawlers fetch this URL with no cookies and no JS, so it has to render
// something meaningful (and correct Open Graph tags) with zero client state.
//
// Public on purpose (see src/middleware.ts's PUBLIC list): '/investors' is
// already there as a prefix, and pathname.startsWith('/investors' + '/')
// covers this route too — no middleware change needed, confirmed by reading
// that matching logic rather than assumed.
import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND_NAME, APP_URL } from '@/lib/brand';
import { LogoLockup } from '@/components/Logo';

const TITLE = `${BRAND_NAME} for investors, in 60 seconds`;
const TAGLINE = 'Built for the 99 you pass on.';
// Separate from TAGLINE on purpose — it opens the on-page paragraph right
// under an <h1> that already says TAGLINE, so repeating it verbatim there
// read as a copy mistake once rendered (caught in browser QA, not just by
// eye on the source).
const DESCRIPTION = 'Curated waves matched to your mandate, every pass reasoned and reopened when the facts change, and evaluation tools that stay yours alone.';
const POSTER_PATH = '/video/investors-poster.jpg';
const VIDEO_PATH = '/video/investors-60.mp4';

const FULL_DESCRIPTION = `${TAGLINE} ${DESCRIPTION}`;

export const metadata: Metadata = {
  title: TITLE,
  description: FULL_DESCRIPTION,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: '/investors/video' },
  openGraph: {
    title: TITLE,
    description: FULL_DESCRIPTION,
    url: `${APP_URL}/investors/video`,
    siteName: BRAND_NAME,
    type: 'website',
    // Deliberately NOT relying on metadataBase's automatic relative->absolute
    // resolution here: confirmed empirically (curl against the dev server)
    // that it resolves `images` but leaves `videos[].url` untouched — a
    // relative og:video is exactly the thing LinkedIn/email preview crawlers
    // (no cookies, no JS, no page origin to resolve against) can't use, so
    // both are spelled out in full to not depend on that resolution at all.
    images: [{ url: `${APP_URL}${POSTER_PATH}`, width: 1920, height: 1080 }],
    videos: [{ url: `${APP_URL}${VIDEO_PATH}`, width: 1920, height: 1080, type: 'video/mp4' }],
  },
  twitter: {
    card: 'player',
    title: TITLE,
    description: FULL_DESCRIPTION,
    images: [`${APP_URL}${POSTER_PATH}`],
  },
};

export default function InvestorVideoPage() {
  return (
    <div className="min-h-screen bg-[#0c272e] text-white">
      <div className="mx-auto flex max-w-4xl flex-col items-center px-4 py-10 sm:py-16">
        <Link href="/investors" className="mb-8 flex items-center gap-2 text-xl font-bold">
          <LogoLockup size={30} accentClassName="text-[#d9a441]" />
        </Link>

        <video
          className="w-full rounded-2xl shadow-2xl"
          controls
          playsInline
          poster={POSTER_PATH}
          preload="metadata"
          aria-label="Sherlock Deal investor workspace, 60-second walkthrough"
        >
          <source src="/video/investors-60.webm" type="video/webm" />
          <source src={VIDEO_PATH} type="video/mp4" />
        </video>

        <h1 className="mt-8 max-w-xl text-center text-2xl font-semibold sm:text-3xl">
          {TAGLINE}
        </h1>
        <p className="mt-3 max-w-lg text-center text-sm text-[#b9d2d7] sm:text-base">
          {DESCRIPTION}
        </p>

        <Link
          href="/claim"
          className="mt-8 inline-flex items-center justify-center rounded-full bg-[#d9a441] px-7 py-3 text-sm font-semibold text-[#0c272e] transition hover:brightness-105"
        >
          Claim your profile
        </Link>
      </div>
    </div>
  );
}
