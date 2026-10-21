// Nuno, 20/10/2026 (screenshot of About › Company): "every time a tab opens the app scrolls down — it should go to the top, or keep its position — and some
// fields end up hidden". Two causes, found by measuring the real layout in a browser before touching it:
//   1. CompanyPanel scrolled the section it opened on to a landing spot (`scrollMarginTop: 148px`) that the real sticky header had outgrown, on MOUNT as well as on
//      every switch — so each visit moved the page down (70px at 1600×560) and left the section's first 38px under the header; the sticky sub-menu and badges
//      columns stuck at that same wrong 148px, under the header too;
//   2. the offset was a number measured once ("at 1366x768"), while the header's height follows the viewport width and the text in it.
// The browser measurement (scaffold under dev:verify, same page and viewport) before → after: opening the tab scrollY 70 → 0; section hidden under the header
// 38px → 0; switching sections from the top, 70px/60px → 0; from deep in the page → to the top. What is pinned here is what keeps it that way.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_HEADER_OFFSET_CSS, SETTINGS_HEADER_OFFSET_PX, SETTINGS_STICKY_HEIGHT_FALLBACK_PX, SETTINGS_STICKY_HEIGHT_VAR } from './settings-layout';
import { publishStickyHeight } from './use-settings-sticky-height';

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('the header offset is a sum of two LIVE heights, not a number', () => {
  it('is the workspace bar plus the page\'s own sticky block, both read from CSS variables the two publish', () => {
    expect(SETTINGS_HEADER_OFFSET_CSS).toBe(
      `calc(var(--workspace-header-height, 73px) + var(${SETTINGS_STICKY_HEIGHT_VAR}, ${SETTINGS_STICKY_HEIGHT_FALLBACK_PX}px))`,
    );
    expect(SETTINGS_STICKY_HEIGHT_VAR).toBe('--settings-sticky-height');
  });

  it('until anything is measured it falls back to the old constant (148px), so the first frame does not jump', () => {
    expect(73 + SETTINGS_STICKY_HEIGHT_FALLBACK_PX).toBe(SETTINGS_HEADER_OFFSET_PX);
    expect(SETTINGS_HEADER_OFFSET_PX).toBe(148);
  });

  it('uses the SAME workspace-bar variable and fallback WorkspaceHeader publishes for its own sticky offset (the two can never disagree)', () => {
    const header = read('../workspace-shell/WorkspaceHeader.tsx');
    expect(header).toContain("WORKSPACE_HEADER_HEIGHT_VAR = '--workspace-header-height'");
    expect(header).toContain('WORKSPACE_HEADER_HEIGHT_PX = 73');
  });
});

describe('publishStickyHeight — the sticky block\'s height, on <html>, kept current', () => {
  function world(initial: number) {
    const props: Record<string, string> = {};
    const root = { style: { setProperty: (k: string, v: string) => { props[k] = v; }, removeProperty: (k: string) => { delete props[k]; } } };
    const el = { height: initial, getBoundingClientRect() { return { height: this.height }; } };
    let fire: () => void = () => {};
    let disconnected = false;
    const makeObserver = (cb: () => void) => { fire = cb; return { observe: () => {}, disconnect: () => { disconnected = true; } }; };
    return { props, root, el, makeObserver, fire: () => fire(), wasDisconnected: () => disconnected };
  }

  it('publishes at once, rounded UP (a fractional pixel must never leave a sliver of the section under the header)', () => {
    const w = world(132.2);
    publishStickyHeight(w.el, w.root, w.makeObserver);
    expect(w.props['--settings-sticky-height']).toBe('133px');
  });

  it('follows the block as it wraps or grows (the pill\'s explanation drops onto a second line, a banner appears…)', () => {
    const w = world(95);
    publishStickyHeight(w.el, w.root, w.makeObserver);
    w.el.height = 181;
    w.fire();
    expect(w.props['--settings-sticky-height']).toBe('181px');
  });

  it('stopping removes the variable and the observer: no other page inherits the About header\'s height', () => {
    const w = world(120);
    const stop = publishStickyHeight(w.el, w.root, w.makeObserver);
    expect(w.props['--settings-sticky-height']).toBe('120px');
    stop();
    expect(w.props['--settings-sticky-height']).toBeUndefined();
    expect(w.wasDisconnected()).toBe(true);
  });

  it('without a ResizeObserver (an old browser) it still publishes once', () => {
    const w = world(110);
    const stop = publishStickyHeight(w.el, w.root);
    expect(w.props['--settings-sticky-height']).toBe('110px');
    stop();
    expect(w.props['--settings-sticky-height']).toBeUndefined();
  });
});

describe('CompanyPanel and the page use it', () => {
  const panel = read('./CompanyPanel.tsx');
  const page = read('../../app/settings/page.tsx');

  it('every section lands with the measured offset as its scroll margin, and the sticky columns stick at it — no px constant left in the style props', () => {
    expect(panel.match(/scrollMarginTop: SETTINGS_HEADER_OFFSET_CSS/g)).toHaveLength(7);
    expect(panel.match(/'--settings-header-offset': SETTINGS_HEADER_OFFSET_CSS/g)).toHaveLength(2);
    expect(panel).not.toMatch(/SETTINGS_HEADER_OFFSET_PX\}px/);
    expect(panel).not.toMatch(/scrollMarginTop: SETTINGS_HEADER_OFFSET_PX/);
  });

  it('opening the tab does not scroll: the effect skips its first run, and a switch goes to the TOP of the page (not scrollIntoView, which landed under the header)', () => {
    const effect = /const openedRef = useRef\(false\);[\s\S]*?\}, \[active, contentEl\]\);/.exec(panel)?.[0] ?? '';
    expect(effect).toContain('if (!openedRef.current) { openedRef.current = true; return; }');
    expect(effect).toContain('window.scrollTo({ top: 0 })');
    expect(effect).not.toContain('scrollIntoView');
    // the guard comes BEFORE the scroll
    expect(effect.indexOf('openedRef.current = true')).toBeLessThan(effect.indexOf('window.scrollTo'));
  });

  it('the page measures its own sticky block: the ref is on it and the hook is called', () => {
    expect(page).toContain('const stickyHeaderRef = useRef<HTMLDivElement>(null);');
    expect(page).toContain('useSettingsStickyHeight(stickyHeaderRef);');
    expect(page).toMatch(/<div ref=\{stickyHeaderRef\} className="lg:sticky/);
  });
});
