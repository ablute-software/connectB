'use client';
// Prompt 934 §B (02/11/2026, Nuno on a phone) — the "Menu" button and its panel in the header of the landing pages, up to 900 px wide (from 901 px up the header holds everything itself and landing.module.css
// hides both). Up to 900 px the header keeps the logo and this button on one line (at 390 px the links, the Startups/Investors selector and the two buttons did not fit and were cut off); the panel
// under the header holds what the header could not: the page's links, the selector (`children`, the same <AudienceToggle> the header uses on a laptop), "Sign in" and "Create account".
//
// A disclosure, not a dialog: the button has aria-expanded / aria-controls, nothing is trapped, and the panel closes when a link in it is chosen, when the visitor taps outside it, on Esc (focus goes back to
// the button) and if the window grows past 900 px. It is `position: absolute` under the header (the header is the fixed one), never a full-window overlay, so it needs no portal.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import s from '@/app/landing.module.css';
import { MENU_PANEL_ID, MOBILE_NAV_MAX_WIDTH, isCloseKey, isOutsideMenu, type MenuLink } from '@/lib/landing-mobile-nav';

export function LandingMenu({ links, signInHref, createHref, children }: {
  links: readonly MenuLink[];
  signInHref: string;
  createHref: string;
  /** The Startups/Investors selector, drawn by the page (a server component) and placed between the links and the buttons. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (isCloseKey(e.key)) { setOpen(false); button.current?.focus(); } };
    const onPointerDown = (e: PointerEvent) => { if (isOutsideMenu(e.target as Node | null, button.current, panel.current)) setOpen(false); };
    const wide = window.matchMedia(`(min-width: ${MOBILE_NAV_MAX_WIDTH + 1}px)`);
    const onResize = () => { if (wide.matches) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    wide.addEventListener('change', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
      wide.removeEventListener('change', onResize);
    };
  }, [open]);

  return (
    <>
      <button ref={button} type="button" className={s.menuBtn} aria-expanded={open} aria-controls={MENU_PANEL_ID} onClick={() => setOpen((o) => !o)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {open
            ? <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            : <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        </svg>
        <span>Menu</span>
      </button>
      {/* A link chosen in the panel closes it (the page scrolls to the section or goes to the other page). */}
      <div ref={panel} id={MENU_PANEL_ID} className={s.menuPanel} data-open={open ? 'true' : 'false'}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>
        <ul className={s.menuList}>
          {links.map((l) => (
            <li key={l.href}><a className={s.menuLink} href={l.href}>{l.label}</a></li>
          ))}
        </ul>
        {children && <div className={s.menuAudience}>{children}</div>}
        <div className={s.menuActions}>
          <Link className={`${s.btn} ${s.btnGhost}`} href={signInHref}>Sign in</Link>
          <Link className={`${s.btn} ${s.btnPrimary}`} href={createHref}>Create account</Link>
        </div>
      </div>
    </>
  );
}
