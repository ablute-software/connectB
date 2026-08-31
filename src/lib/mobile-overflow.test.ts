import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

// Prompt 499 — three horizontal-overflow fixes for a phone screen, pinned
// against silent removal.
//
// WHAT THIS TEST IS, AND WHAT IT IS NOT. This project has no jsdom, no
// @testing-library and no JSX transform for vitest, and no browser MCP tool
// is available in this environment — so nothing here can render a component
// at 375px and measure it. What a regex over source CAN do is notice the
// day someone deletes the class that makes the fix work, which is exactly
// how these three regressed into existence: none of them was ever wrong on
// a wide screen, so nothing on a wide screen would ever complain. A green
// run is proof the classes are still there, not proof the layout is right.
//
// Same discipline, and the same stated limitation, as
// no-fire-and-forget.test.ts.

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Prompt 499 §1 — the shared Tabs strip scrolls instead of squashing', () => {
  const ui = read('src/components/ui.tsx');

  it('the tablist container can scroll horizontally', () => {
    // Nine files use <Tabs>, including the seven-tab Readiness bar. The
    // container is the half that lets the overflow exist at all.
    expect(ui).toMatch(/role="tablist"[^>]*className="[^"]*overflow-x-auto/);
  });

  it('each tab keeps its own width instead of shrinking below its label', () => {
    // The other half, and the one that is easy to lose in a className
    // rewrite: without shrink-0 the flex items compress and there is never
    // any overflow to scroll.
    expect(ui).toMatch(/className=\{`relative flex shrink-0 items-center[^`]*whitespace-nowrap/);
  });
});

describe('Prompt 499 §2/§3 — two tables that could not scroll', () => {
  it("the dashboard's overrides log is wrapped in a scroll container", () => {
    // Four columns, one of them a free-text justification, previously with
    // no wrapper at all.
    const overview = read('src/components/dashboard/OverviewPanel.tsx');
    expect(overview).toMatch(/<div className="overflow-x-auto">\s*<table/);
  });

  it('the comparable-rounds table scrolls rather than being cut off', () => {
    // This one had `overflow-hidden`, which is why it CUT the five columns
    // instead of pushing the page: the clipping was doing real work
    // (rounding the corners), so the fix is `overflow-x-auto`, which clips
    // AND scrolls — never simply deleting the overflow class.
    const card = read('src/components/readiness/market/ComparableRoundsCard.tsx');
    expect(card).toMatch(/<div className="overflow-x-auto rounded-lg border border-gray-200">/);
    expect(card).not.toMatch(/overflow-hidden rounded-lg border border-gray-200/);
  });
});
