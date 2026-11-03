// Prompt 927 (D) — the currency selector in a REAL browser: it opens a list with the most used first (EUR, USD, GBP), it can be searched by code and by name, Enter picks the first match, Escape closes, a
// click elsewhere closes, and nothing is wider than the screen at 1280, 768 and 375 px. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-927');

describe.skipIf(!CHROME)('the currency selector (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'currency-select-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/currency-select.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `currency-select-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(width: number) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 700 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as { __startCurrency: (v: string) => void }).__startCurrency('EUR'));
    await page.waitForSelector('[data-testid="currency-button"]');
    const value = () => page.evaluate(() => (window as unknown as { __currencyValue: string }).__currencyValue);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, value, overflow };
  }

  it('opens with EUR, USD and GBP first; searches by code and by name; picks with a click or with Enter; Escape and a click elsewhere close it', async () => {
    const { page, value, errors } = await open(1280);
    expect(await page.locator('[data-testid="currency-button"]').innerText()).toContain('EUR');
    await page.locator('[data-testid="currency-button"]').click();
    const codes = await page.locator('[role="option"] button span.font-mono').allInnerTexts();
    expect(codes.slice(0, 3)).toEqual(['EUR', 'USD', 'GBP']);
    expect(codes).toEqual(expect.arrayContaining(['JPY', 'KWD', 'TND', 'ILS', 'AED', 'KRW']));
    await page.locator('[data-testid="currency-search"]').fill('jpy');
    expect(await page.locator('[role="option"]').count()).toBe(1);
    await page.locator('[data-testid="currency-JPY"]').click();
    expect(await value()).toBe('JPY');
    expect(await page.locator('[data-testid="currency-panel"]').count()).toBe(0);
    expect(await page.locator('[data-testid="currency-button"]').innerText()).toContain('Japanese yen');
    await page.locator('[data-testid="currency-button"]').click();
    await page.locator('[data-testid="currency-search"]').fill('dinar');
    expect(await page.locator('[role="option"] span.font-mono').allInnerTexts()).toEqual(['BHD', 'DZD', 'JOD', 'KWD', 'TND']);
    await page.keyboard.press('Enter');                                                     // the first match
    expect(await value()).toBe('BHD');
    await page.locator('[data-testid="currency-button"]').click();
    await page.locator('[data-testid="currency-search"]').fill('nothing like this');
    expect(await page.locator('[data-testid="currency-none"]').innerText()).toContain('No currency matches');
    await page.keyboard.press('Escape');
    expect(await page.locator('[data-testid="currency-panel"]').count()).toBe(0);
    await page.locator('[data-testid="currency-button"]').click();
    await page.mouse.click(5, 600);                                                         // elsewhere
    expect(await page.locator('[data-testid="currency-panel"]').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('nothing is wider than the screen at 1280, 768 and 375 — the list scrolls inside its panel', async () => {
    for (const width of [1280, 768, 375]) {
      const { page, overflow } = await open(width);
      await page.locator('[data-testid="currency-button"]').click();
      expect(await overflow(), `${width}`).toBeLessThanOrEqual(0);
      const box = await page.locator('[data-testid="currency-panel"]').boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width + 0.5, `${width}`).toBe(true);
      const list = page.locator('[role="listbox"]');
      expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto'), `${width}`).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `currency-select-${width}.png`) });
      await page.close();
    }
  }, 120_000);
});
