'use client';
import { useEffect, useRef } from 'react';
// Prompt 127 Bloco A — sticky top bar, shared between the founder and
// investor shells. Deliberately does NOT own the `flex-1 md:ml-60` wrapper
// or <main> — the founder's <main> is a fixed max-w-6xl, the investor's
// varies by which tab is active, and that tab-awareness has no business
// leaking into a chrome-only primitive.
import type { ReactNode } from 'react';
import { MatchDealButton } from './MatchDealButton';

// Prompt 613 §H / 615 — the height of this bar, published as a CSS variable
// on the document root and kept current by a ResizeObserver. A page that
// sticks something of its own to the top has to stick it BELOW this; without
// a number, each page guesses, which is how the About sub-header came to sit
// at top:0 in the same band as this one and paint over it.
//
// MEASURED, NOT ASSUMED, and the difference showed up immediately: the bar is
// 73px at a 1280px viewport and 53px at 1366px, because its contents wrap
// differently. The constant this started as was therefore wrong at every width
// but one — 20px of dead gap at 1366. It survives only as the pre-paint
// fallback, for the first frame before the observer has measured anything.
export const WORKSPACE_HEADER_HEIGHT_PX = 73;
export const WORKSPACE_HEADER_HEIGHT_VAR = '--workspace-header-height';

/** `top` value for anything that must stick directly below the workspace bar. */
export const STICK_BELOW_WORKSPACE_HEADER = `var(${WORKSPACE_HEADER_HEIGHT_VAR}, ${WORKSPACE_HEADER_HEIGHT_PX}px)`;

export function WorkspaceHeader({ left, right, matchDeal, desktopAlign = 'between' }: {
  left?: ReactNode;
  right: ReactNode;
  // Prompt 576 §3 — optional for the back-office console: "connect the
  // MatchDeal app" has no meaning for a platform-admin session with no
  // startup/investor profile of its own. Every existing caller (founder,
  // investor) still always passes this, so their header is unchanged.
  matchDeal?: { kind: 'startup' | 'investor'; tooltip: string };
  // Founder's `left` always has visible content at every breakpoint (org
  // name on mobile, tagline on desktop) so plain justify-between works.
  // Investor's `left` is a mobile-only logout button — on desktop it
  // renders nothing, and a single remaining flex child under
  // justify-between lands at flex-start, not flex-end, hence 'end'.
  desktopAlign?: 'between' | 'end';
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty(WORKSPACE_HEADER_HEIGHT_VAR, `${Math.round(el.getBoundingClientRect().height)}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header ref={ref} className={`sticky top-0 z-10 flex items-center gap-3 justify-between border-b border-gray-100 bg-white/85 px-4 py-2.5 backdrop-blur md:px-8 ${desktopAlign === 'end' ? 'md:justify-end' : ''}`}>
      {left}
      <div className="flex items-center gap-4">
        {matchDeal && <MatchDealButton kind={matchDeal.kind} tooltip={matchDeal.tooltip} />}
        {right}
      </div>
    </header>
  );
}
