// Contact & Support — the public entry point, linked from the footer of
// both landing sides. Same standalone frosted-glass treatment as
// login/signup (AuthShell) rather than the full landing chrome — this is a
// utility page, not a marketing one. `?from=investors` (set by the
// /investors footer link) is the only thing that decides which `source`
// gets recorded; nothing else about the form changes between the two.
//
// Prompt 920 addendum (19/10/2026) — this was a client component whose whole tree sat behind a <Suspense> with a null fallback, so the HTML a
// crawler read was empty (Next's BAILOUT_TO_CLIENT_SIDE_RENDERING) and, with no metadata of its own, the page answered with the layout's
// generic title and description. It is now a server component: the title, the description, a heading and the text are in the first
// byte, and the form is the fallback of the one boundary that has to wait for the query string (ContactFormForVisitor), so even that
// is on the page before any JavaScript runs.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { ContactForm } from '@/components/ContactForm';
import { ContactFormForVisitor } from '@/components/ContactFormForVisitor';
import { LogoLockup } from '@/components/Logo';
import { APP_URL, BRAND_NAME } from '@/lib/brand';
import { OG_DEFAULT_IMAGE } from '@/content/site/pages';

const TITLE = `${BRAND_NAME} — Contact`;
const DESCRIPTION = 'Got a question, found a bug, or something doesn’t look right? Tell us here — we read every message.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: '/contact' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${APP_URL}/contact`, siteName: BRAND_NAME, type: 'website', locale: 'en', images: [OG_DEFAULT_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [{ url: OG_DEFAULT_IMAGE.url, alt: OG_DEFAULT_IMAGE.alt }] },
};

export default function ContactPage() {
  return (
    <AuthShell>
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-7 shadow-2xl">
        <h1 className="sr-only">Contact {BRAND_NAME}</h1>
        <div className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'var(--font-comfortaa), var(--font-inter), sans-serif' }}>
          <LogoLockup size={28} accentClassName="text-[#2a7f8e]" />
        </div>
        <p className="mb-5 text-sm text-gray-500">
          Got a question, found a bug, or something doesn&apos;t look right? Tell us here — we read every message.
        </p>
        <Suspense fallback={<ContactForm source="landing" />}>
          <ContactFormForVisitor />
        </Suspense>
      </div>
    </AuthShell>
  );
}
