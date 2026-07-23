'use client';
// Landing page motion, ported from the reference file's inline script. Renders
// nothing — it only wires three observers to data-attribute hooks, so it never
// depends on CSS-module hashed class names:
//   [data-nav]    → data-scrolled="true" once the page scrolls past 30px
//   [data-reveal] → data-in="true" when it enters the viewport (once)
//   [data-meter]  → its [data-fill] bars animate to their data-w width (once)
import { useEffect } from 'react';

export function LandingEffects() {
  useEffect(() => {
    // Smooth in-page anchor scrolling, scoped to this page's lifetime (a CSS
    // module can't style <html>, and we don't want it leaking into the app).
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'smooth';

    const nav = document.querySelector<HTMLElement>('[data-nav]');
    const onScroll = () => nav?.setAttribute('data-scrolled', String(window.scrollY > 30));
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const reveals = document.querySelectorAll<HTMLElement>('[data-reveal]');
    const meters = document.querySelectorAll<HTMLElement>('[data-meter]');

    // Safety net: .rv starts at opacity 0, so if IntersectionObserver were
    // unavailable the content below the hero would never appear. Reveal
    // everything immediately instead of risking an invisible page.
    if (!('IntersectionObserver' in window)) {
      reveals.forEach((el) => { el.dataset.in = 'true'; });
      meters.forEach((m) => m.querySelectorAll<HTMLElement>('[data-fill]').forEach((f) => {
        if (f.dataset.w) f.style.width = f.dataset.w;
      }));
      return () => {
        window.removeEventListener('scroll', onScroll);
        root.style.scrollBehavior = previousScrollBehavior;
      };
    }

    const revealIo = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        (e.target as HTMLElement).dataset.in = 'true';
        revealIo.unobserve(e.target);
      });
    }, { threshold: 0.15 });
    reveals.forEach((el) => revealIo.observe(el));

    const meterIo = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.querySelectorAll<HTMLElement>('[data-fill]').forEach((f) => {
          if (f.dataset.w) f.style.width = f.dataset.w;
        });
        meterIo.unobserve(e.target);
      });
    }, { threshold: 0.3 });
    meters.forEach((m) => meterIo.observe(m));

    return () => {
      window.removeEventListener('scroll', onScroll);
      revealIo.disconnect();
      meterIo.disconnect();
      root.style.scrollBehavior = previousScrollBehavior;
    };
  }, []);

  return null;
}
