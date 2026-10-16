// Prompt 920 — the frame of the public marketing pages (/for-startups, /about, /faq): the landing's own navigation bar and footer, built
// from the landing's own styles and fonts, so a visitor moving between the home and these pages stays in the same site. The nav is
// drawn in its "scrolled" (white) state from the start — these pages have no dark hero behind it — and nothing here animates or hides content.
//
// The footer is the three-column one of §E (Product / Company / Legal). The home and /investors keep their existing footer rows and only gain
// the About and FAQ links (§F.2), so the landing does not change shape.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Fraunces, Inter } from 'next/font/google';
import { LogoLockup } from '@/components/Logo';
import { AudienceToggle } from '@/components/landing/AudienceToggle';
import { BRAND_NAME } from '@/lib/brand';
import s from '@/app/landing.module.css';
import p from './site-page.module.css';

const fraunces = Fraunces({
  subsets: ['latin'], weight: ['400', '600', '700'], style: ['normal', 'italic'],
  variable: '--font-fraunces', display: 'swap',
});
const inter = Inter({
  subsets: ['latin'], weight: ['400', '500', '600', '700'],
  variable: '--font-inter', display: 'swap',
});

export const FOOTER_COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '/#features' },
      { label: 'How it works', href: '/#how' },
      { label: 'Pricing', href: '/#pricing' },
      { label: 'For startups', href: '/for-startups' },
      { label: 'For investors', href: '/investors' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'FAQ', href: '/faq' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy notice', href: '/legal/privacy-notice' },
      { label: 'Data-rights request', href: '/privacy-request' },
      { label: 'Suppliers', href: '/legal/subprocessors' },
      { label: 'Terms', href: '/terms' },
    ],
  },
];

export function PublicSiteLayout({ children, active = null }: { children: ReactNode; active?: 'startup' | 'investor' | null }) {
  return (
    <div className={`${fraunces.variable} ${inter.variable} ${s.landing} ${p.site}`}>
      <nav className={s.nav} data-scrolled="true" aria-label="Main">
        <div className={`${s.wrap} ${p.navWrap}`}>
          <Link className={s.logo} href="/">
            <LogoLockup size={32} accentClassName={s.deal} />
          </Link>
          <div className={`${s.navLinks} ${p.navLinks}`}>
            <Link className={s.link} href="/#features">Features</Link>
            <Link className={s.link} href="/#how">How it works</Link>
            <Link className={s.link} href="/#pricing">Pricing</Link>
            <AudienceToggle active={active} />
            <Link className={`${s.btn} ${s.btnGhost} ${s.btnSm} ${p.navSignIn}`} href="/login">Sign in</Link>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnSm} ${p.navCreate}`} href="/signup">Create account</Link>
          </div>
        </div>
      </nav>

      <main className={p.main}>{children}</main>

      <footer className={s.footerEl}>
        <div className={s.wrap}>
          <Link className={`${s.logo} ${p.footerLogo}`} href="/">
            <LogoLockup size={26} accentClassName={s.deal} />
          </Link>
          <nav className={p.footerCols} aria-label="Footer">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <p className={p.footerHead}>{col.title}</p>
                <ul>
                  {col.links.map((l) => (
                    <li key={l.href}><Link href={l.href}>{l.label}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <p className={s.cp}>© {new Date().getFullYear()} {BRAND_NAME} · Investor relations, investigated.</p>
        </div>
      </footer>
    </div>
  );
}
