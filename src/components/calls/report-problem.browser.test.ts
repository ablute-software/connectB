// Prompt 918 (I3) — "Report a problem" in a REAL browser (the real ReportProblem): it opens a form IN the page (never a browser dialog), asks for the email only when signed out, refuses a too-short message with
// the sentence, sends what the route expects, confirms on screen, shows the server's refusal (rate limit) instead of failing silently, and is never wider than the screen at 1280/768/375.
// Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://report.test';
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-918-i3');

describe.skipIf(!CHROME)('Report a problem (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-problem-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/report-problem.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `report-problem-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(width: number, signedIn: boolean, reply: { status: number; body: unknown } = { status: 200, body: { ok: true } }) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 700 });
    const errors: string[] = []; const dialogs: string[] = []; const posted: { url: string; body: Record<string, unknown> }[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` });
      posted.push({ url: url.pathname, body: JSON.parse(route.request().postData() ?? '{}') });
      return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate((s) => (window as unknown as { __startReport: (s: boolean) => void }).__startReport(s), signedIn);
    await page.waitForSelector('[data-testid="report-problem"]');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, posted, overflow };
  }

  it('signed out: asks for the email too; a too-short message is refused with the sentence; a good one is sent and confirmed in the page', async () => {
    const { page, errors, dialogs, posted } = await open(1280, false);
    await page.locator('[data-testid="report-open"]').click();
    expect(await page.locator('[data-testid="report-email"]').count()).toBe(1);
    await page.getByRole('button', { name: /send/i }).click();
    expect(await page.locator('[data-testid="report-error"]').innerText()).toBe('Please tell us a little more (at least 10 characters).');
    expect(posted).toEqual([]);
    await page.locator('#report-message').fill('The Submit button does nothing on my phone.');
    await page.locator('[data-testid="report-email"]').fill('ana@example.com');
    await page.getByRole('button', { name: /send/i }).click();
    await page.waitForSelector('[data-testid="report-sent"]');
    expect(await page.locator('[data-testid="report-sent"]').innerText()).toContain('marked urgent');
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe('/api/calls/public/tok-1/report');
    expect(posted[0].body).toMatchObject({ message: 'The Submit button does nothing on my phone.', email: 'ana@example.com' });
    expect(errors).toEqual([]);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('signed in: no email asked; the server\'s refusal (too many reports) is shown, not swallowed, and the text is kept', async () => {
    const { page } = await open(1280, true, { status: 429, body: { ok: false, error: 'Too many reports in a short time. Please wait a few minutes.' } });
    await page.locator('[data-testid="report-open"]').click();
    expect(await page.locator('[data-testid="report-email"]').count()).toBe(0);
    await page.locator('#report-message').fill('Something odd happened with the upload.');
    await page.getByRole('button', { name: /send/i }).click();
    expect(await page.locator('[data-testid="report-error"]').innerText()).toBe('Too many reports in a short time. Please wait a few minutes.');
    expect(await page.locator('#report-message').inputValue()).toBe('Something odd happened with the upload.');
    await page.close();
  }, 120_000);

  it('nothing is wider than the screen at 1280, 768 and 375 (screenshots kept)', async () => {
    for (const width of [1280, 768, 375]) {
      const { page, overflow } = await open(width, false);
      await page.locator('[data-testid="report-open"]').click();
      await page.locator('#report-message').fill('A_very_long_unbroken_word_that_cannot_wrap_anywhere_by_itself_1234567890_and_more_and_more_and_more');
      expect(await overflow(), `${width}px`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(SHOTS, `${width}-report-problem.png`), fullPage: true });
      await page.close();
    }
  }, 120_000);
});
