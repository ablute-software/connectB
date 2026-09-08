'use client';
// Prompt 127 Bloco A — sticky top bar, shared between the founder and
// investor shells. Deliberately does NOT own the `flex-1 md:ml-60` wrapper
// or <main> — the founder's <main> is a fixed max-w-6xl, the investor's
// varies by which tab is active, and that tab-awareness has no business
// leaking into a chrome-only primitive.
import type { ReactNode } from 'react';
import { MatchDealButton } from './MatchDealButton';

// Prompt 613 §H — the rendered height of this bar, measured live (1280px
// viewport, 2026-09-08: 73px). A page that sticks something of its own to the
// top has to stick it BELOW this, and needs a number to do that with; without
// one, each page guesses, which is how the About sub-header came to sit at
// top:0 in the same band as this one.
export const WORKSPACE_HEADER_HEIGHT_PX = 73;

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
  return (
    <header className={`sticky top-0 z-10 flex items-center gap-3 justify-between border-b border-gray-100 bg-white/85 px-4 py-2.5 backdrop-blur md:px-8 ${desktopAlign === 'end' ? 'md:justify-end' : ''}`}>
      {left}
      <div className="flex items-center gap-4">
        {matchDeal && <MatchDealButton kind={matchDeal.kind} tooltip={matchDeal.tooltip} />}
        {right}
      </div>
    </header>
  );
}
