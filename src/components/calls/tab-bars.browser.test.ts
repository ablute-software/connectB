// Prompt 922 (Adenda 2, 30/10/2026) — the bars of tabs of the call editor (Setup / Applications / Evaluation / Results, and inside them the sections of Results, the eligibility views and the board), in a REAL Chrome with
// the SCROLLBARS VISIBLE (as on Windows: headless Chrome hides them by default, which is how a vertical bar with ▲▼ arrows went unseen). A bar never scrolls vertically, never draws a scrollbar, and at 1280 px
// shows every tab (they wrap if they must); on a phone it scrolls sideways, without a visible bar, only when the tabs do not fit. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-922-adenda2');

describe.skipIf(!CHROME)('the bars of tabs (real browser, scrollbars visible)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-bars-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/call-editor-access.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `tab-bars-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    // The scrollbars of Windows: headless Chrome hides them unless told not to.
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], ignoreDefaultArgs: ['--hide-scrollbars'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(width: number) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://app.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto('http://app.test/calls');
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as { __startEditor: (o: unknown) => void }).__startEditor({ configure: true, viewApplications: true, evaluate: true, publishResults: true, handleContestations: true, status: 'open' }));
    await page.waitForSelector('[data-testid="main-tabs"]');
    await page.waitForTimeout(250);
    return { page, errors };
  }

  /** What every bar of tabs on the screen must satisfy, measured the way the eye sees it: no vertical scroll, no scrollbar drawn, and (wide) nothing hidden to the side. */
  const measure = (page: import('playwright').Page) => page.evaluate(() => {
    const bars = [...document.querySelectorAll('[role="tablist"]')].filter((b) => (b as HTMLElement).offsetParent !== null) as HTMLElement[];
    return bars.map((b) => {
      const cs = getComputedStyle(b);
      return {
        label: b.getAttribute('aria-label'), overflowY: cs.overflowY, overflowX: cs.overflowX,
        verticalScrollable: b.scrollHeight > b.clientHeight + 1 && cs.overflowY !== 'visible' && cs.overflowY !== 'hidden',
        clippedVertically: b.scrollHeight > b.clientHeight + 1 && cs.overflowY === 'hidden',
        scrollbarDrawn: b.offsetWidth - b.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth) > 0.5 || b.offsetHeight - b.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth) > 0.5,
        sideways: b.scrollWidth > b.clientWidth + 1,
        tabs: b.querySelectorAll('[role="tab"]').length,
        arrows: b.parentElement?.querySelectorAll('[data-testid^="tabs-scroll-"]').length ?? 0,
      };
    });
  });

  async function everyBar(page: import('playwright').Page) {
    const seen: Awaited<ReturnType<typeof measure>> = [];
    for (const t of ['applications', 'evaluation', 'results', 'setup']) {
      const tab = page.locator(`[data-testid="tab-${t}"]`);
      if (await tab.count()) { await tab.click(); await page.waitForTimeout(500); }
      for (const m of await measure(page)) if (!seen.some((x) => x.label === m.label)) seen.push(m);
    }
    return seen;
  }

  it('1280 px with scrollbars visible: no bar of the call scrolls, none draws a scrollbar, every tab is there and nothing is hidden sideways', async () => {
    const { page, errors } = await open(1280);
    const bars = await everyBar(page);
    expect(bars.map((b) => b.label)).toEqual(expect.arrayContaining(['Call', 'Results']));
    for (const b of bars) {
      expect(b, b.label ?? '').toMatchObject({ verticalScrollable: false, scrollbarDrawn: false, sideways: false, arrows: 0 });
      expect(['visible', 'hidden']).toContain(b.overflowY);
      expect(b.tabs).toBeGreaterThan(0);
    }
    // the sections of Results: Prepare / Publish / Contestations / Close
    await page.locator('[data-testid="tab-results"]').click();
    await page.waitForTimeout(400);
    const results = (await measure(page)).find((b) => b.label === 'Results');
    expect(results?.tabs).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: path.join(SHOTS, 'tab-bars-1280.png') });
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('375 px: a bar that does not fit scrolls sideways only, with no scrollbar drawn and no vertical scroll, and the arrow shows what is beyond', async () => {
    const { page, errors } = await open(375);
    const bars = await everyBar(page);
    for (const b of bars) expect(b, b.label ?? '').toMatchObject({ verticalScrollable: false, scrollbarDrawn: false, overflowY: 'hidden' });
    // (four short tabs fit a phone: the bars that do not fit are covered by scroll-tabs.browser.test.ts; whichever overflows here must show its arrow)
    expect(bars.filter((b) => b.sideways).every((b) => b.arrows >= 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(SHOTS, 'tab-bars-375.png') });
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);
});
