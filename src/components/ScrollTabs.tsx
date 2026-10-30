'use client';
// Prompt 924 (acerto, 29/10/2026) — the bar of tabs, with arrows to scroll it. When the tabs do not fit (a phone, a long list) the bar scrolls sideways, and on its own nothing says so: the tabs past the edge are
// simply not there. Here an arrow appears at the edge that has more behind it (and only then), a click moves the bar by most of its width, and the tab that is selected is always brought into view.
// The arrows are not tabs and are outside the `tablist`; the bar itself is the same element as before (same classes, same children), so the tab buttons and their keys are untouched.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const MARGIN = /(?:^|\s)(-?m[trblxy]?-\S+)/g;

export function ScrollTabs({ label, className = '', testId, children }: { label: string; className?: string; testId?: string; children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const seen = useRef<Element | null>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  // The margin belongs to the whole thing (so the arrows are as tall as the bar, not as the bar plus its margin).
  const margins = className.match(MARGIN)?.map((m) => m.trim()).join(' ') ?? '';
  const rest = className.replace(MARGIN, '').trim();

  const measure = useCallback(() => {
    const el = bar.current; if (!el) return;
    const left = el.scrollLeft > 1; const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdge((p) => (p.left === left && p.right === right ? p : { left, right }));
  }, []);

  useEffect(() => {
    const el = bar.current; if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [measure]);

  // After every render: the tabs may have changed (a tab appeared), and the selected one must be in view when it changes.
  useEffect(() => {
    const el = bar.current; if (!el) return;
    measure();
    const on = el.querySelector('[aria-selected="true"]');
    if (on && on !== seen.current) {
      const a = el.getBoundingClientRect(); const b = on.getBoundingClientRect();
      if (b.left < a.left) el.scrollBy({ left: b.left - a.left - 24 });
      else if (b.right > a.right) el.scrollBy({ left: b.right - a.right + 24 });
    }
    seen.current = on;
  });

  const go = (dir: -1 | 1) => { const el = bar.current; if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' }); };
  const ARROW = 'absolute top-0 bottom-0 z-10 flex w-9 items-center justify-center text-gray-600 hover:text-gray-900';
  return (
    <div className={`relative min-w-0 ${margins}`} data-testid={testId ? `${testId}-scroll` : undefined}>
      <div ref={bar} role="tablist" aria-label={label} className={`${rest} [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`} data-testid={testId}>{children}</div>
      {edge.left && (
        <button type="button" tabIndex={-1} aria-label="Show the tabs on the left" data-testid="tabs-scroll-left" onClick={() => go(-1)}
          className={`${ARROW} left-0 bg-gradient-to-r from-white from-60% to-transparent`}><span aria-hidden="true">‹</span></button>
      )}
      {edge.right && (
        <button type="button" tabIndex={-1} aria-label="Show the tabs on the right" data-testid="tabs-scroll-right" onClick={() => go(1)}
          className={`${ARROW} right-0 bg-gradient-to-l from-white from-60% to-transparent`}><span aria-hidden="true">›</span></button>
      )}
    </div>
  );
}
