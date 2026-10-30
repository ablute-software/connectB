// Prompt 924 (acerto, 29/10/2026) — the bar of tabs with arrows, in a REAL browser (the real ScrollTabs bundled with rolldown): at 375 px a long bar shows the arrow of the side that has more, a click moves the bar and
// the other arrow appears, the selected tab is brought into view, a bar that fits shows no arrow, and nothing is wider than the screen. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));

describe.skipIf(!CHROME)('Tabs with scroll arrows (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scroll-tabs-'));
    await build({
      input: path.join(process.cwd(), 'src/components/scroll-tabs.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `scroll-tabs-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/ScrollTabs.tsx,src/components/scroll-tabs.harness.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], ignoreDefaultArgs: ['--hide-scrollbars'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(width: number, count: number) {
    const page = await browser.newPage({ viewport: { width, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://app.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto('http://app.test/tabs');
    await page.addScriptTag({ content: bundle });
    await page.evaluate((c) => (window as unknown as { __startTabs: (x: unknown) => void }).__startTabs({ count: c }), count);
    await page.waitForSelector('[role="tablist"]');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, overflow };
  }

  it('375 px: a long bar shows the right arrow only; a click moves it and the left arrow appears; at the end only the left one is left', async () => {
    const { page, errors, overflow } = await open(375, 12);
    await page.waitForSelector('[data-testid="tabs-scroll-right"]');
    expect(await page.locator('[data-testid="tabs-scroll-left"]').count()).toBe(0);
    const box = await page.locator('[data-testid="tabs-scroll-right"]').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(32);
    expect(box!.height).toBeGreaterThanOrEqual(32);
    await page.locator('[data-testid="tabs-scroll-right"]').click();
    await page.waitForSelector('[data-testid="tabs-scroll-left"]');
    expect(await page.locator('[data-testid="bar"]').evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
    for (let i = 0; i < 12 && (await page.locator('[data-testid="tabs-scroll-right"]').count()) > 0; i++) { await page.locator('[data-testid="tabs-scroll-right"]').click(); await page.waitForTimeout(350); }
    expect(await page.locator('[data-testid="tabs-scroll-right"]').count()).toBe(0);
    expect(await page.locator('[data-testid="tabs-scroll-left"]').count()).toBe(1);
    // the last tab is reachable (inside the bar's box) once it is at the end
    const bar = await page.locator('[data-testid="bar"]').boundingBox(); const last = await page.locator('[data-testid="tab-11"]').boundingBox();
    expect(last!.x + last!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 1);
    expect(await page.locator('[data-testid="bar"]').evaluate((el) => { const b = el as HTMLElement; const cs = getComputedStyle(b); return [cs.overflowY, b.offsetWidth - b.clientWidth, b.scrollHeight <= b.clientHeight + 1]; })).toEqual(['hidden', 0, true]);
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('the selected tab is brought into view, and the tabs are still tabs (the arrows are outside the tablist)', async () => {
    const { page } = await open(375, 12);
    await page.waitForSelector('[data-testid="tabs-scroll-right"]');
    await page.locator('[data-testid="select-last"]').click();
    await page.waitForFunction(() => { const b = document.querySelector('[data-testid="bar"]')!.getBoundingClientRect(); const t = document.querySelector('[data-testid="tab-11"]')!.getBoundingClientRect(); return t.right <= b.right + 1; }, null, { timeout: 5000 });
    expect(await page.locator('[role="tablist"] [role="tab"]').count()).toBe(12);
    expect(await page.locator('[role="tablist"] button:not([role="tab"])').count()).toBe(0);
    await page.close();
  }, 120_000);

  it('1280 px with few tabs: no arrow at all; 768 px with many: they wrap, nothing hidden; no horizontal scroll of the page at any width', async () => {
    const wide = await open(1280, 4);
    expect(await wide.page.locator('[data-testid^="tabs-scroll-"]').count()).toBe(0);
    expect(await wide.overflow()).toBeLessThanOrEqual(0);
    await wide.page.close();
    // from 768 px up the tabs wrap instead of scrolling: nothing hidden, no arrow, no scrollbar
    const mid = await open(768, 14);
    expect(await mid.page.locator('[data-testid^="tabs-scroll-"]').count()).toBe(0);
    const m = await mid.page.locator('[data-testid="bar"]').evaluate((el) => { const b = el as HTMLElement; const cs = getComputedStyle(b); return { overflowY: cs.overflowY, wrapped: b.scrollHeight > 60, sideways: b.scrollWidth > b.clientWidth + 1, drawn: b.offsetWidth - b.clientWidth > 0.5 || b.offsetHeight - b.clientHeight - parseFloat(cs.borderBottomWidth) > 0.5 }; });
    expect(m).toMatchObject({ overflowY: 'visible', sideways: false, drawn: false });
    expect(await mid.overflow()).toBeLessThanOrEqual(0);
    await mid.page.close();
  }, 120_000);
});
