'use client';
// Prompt 934 §A (02/11/2026, Nuno on a phone) — the bar fixed to the bottom of the screen with "Sign in" and "Create account", on the landing pages, up to 900 px wide (landing.module.css hides it from
// 901 px up: a desktop has both buttons in the header). It is on screen only once the hero's own row of buttons ([data-hero-ctas]) has left the screen — while they are there the bar would say the same
// thing twice — and never for a signed-in visitor.
//
// Why the visitor's state is a prop and not a cookie read here: this page is rendered per request with the visitor's session (`Cache-Control: private, no-store`) and its server code already
// asks `getUser()` to decide the redirect, so `signedIn` is the validated answer. A cookie read in the browser could not tell a live session from a stale one, and would hide "Sign in" from the very
// person who needs it. Nothing here calls an API.
//
// It is `position: fixed` and moves with `transform`/`opacity` only, so it never pushes anything: appearing and disappearing cannot shift the layout (CLS 0). It sits inside `.landing`, which has no
// transform, filter or perspective, so the fixed position is the window's (it is not a full-window overlay: the project's createPortal rule is about those). From the moment it is on the page (not only
// while it is in sight) it sets `data-landing-bar` on <html>, which the stylesheet uses to leave room for it under the footer: tied to "in sight", a visitor who jumps straight to the end of the page (the End
// key, a link to the footer) would arrive 56 px short of the end, with the bar already drawn over the last line, and only a further scroll would uncover it. The room is at the very end of the document,
// so adding it moves nothing that is on screen.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import s from '@/app/landing.module.css';
import { BAR_FLAG_ATTR, HERO_CTAS_SELECTOR, NAV_HEIGHT, barVisible } from '@/lib/landing-mobile-nav';

export function LandingMobileBar({ signedIn, signInHref, createHref }: { signedIn: boolean; signInHref: string; createHref: string }) {
  if (signedIn) return null;
  return <Bar signInHref={signInHref} createHref={createHref} />;
}

function Bar({ signInHref, createHref }: { signInHref: string; createHref: string }) {
  // null until measured: the server render and the first client render are both "hidden"
  const [ctasOnScreen, setCtasOnScreen] = useState<boolean | null>(null);

  useEffect(() => {
    const ctas = document.querySelector(HERO_CTAS_SELECTOR);
    // No row to watch (the markup changed) or no IntersectionObserver: the bar is simply there. Two buttons said twice is better than none.
    if (!ctas || !('IntersectionObserver' in window)) { setCtasOnScreen(false); return; }
    // The top margin is the header: a row that has slid under it is out of view.
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setCtasOnScreen(last.isIntersecting);
    }, { rootMargin: `-${NAV_HEIGHT}px 0px 0px 0px` });
    io.observe(ctas);
    return () => io.disconnect();
  }, []);

  const visible = barVisible(ctasOnScreen, false);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(BAR_FLAG_ATTR, 'on');
    return () => root.removeAttribute(BAR_FLAG_ATTR);
  }, []);

  return (
    <div className={s.mobileBar} data-visible={visible ? 'true' : 'false'} role="group" aria-label="Sign in or create an account">
      <Link className={`${s.btn} ${s.btnGhost}`} href={signInHref}>Sign in</Link>
      <Link className={`${s.btn} ${s.btnPrimary}`} href={createHref}>Create account</Link>
    </div>
  );
}
