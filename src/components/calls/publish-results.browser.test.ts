// Prompt 924 (Etapa 4, I2) — Results → Publish in a REAL browser (the real PublishResults bundled with rolldown; the server is a stub that behaves like the routes where it matters to the screen). What will go out and
// to how many, what blocks it (with a way back to Prepare), the test email, publishing now or at a time with the name of the call typed IN THE PAGE to confirm (never a browser dialog), the schedule that can be cancelled,
// and the state of every email with "Send again" — and nothing wider than the screen at 375, 768 and 1280. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const NAME = 'Seed Call 2027';

describe.skipIf(!CHROME)('Results → Publish (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-results-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/publish-results.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `publish-results-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(opts: { pending?: boolean; width?: number } = {}) {
    const page = await browser.newPage({ viewport: { width: opts.width ?? 1280, height: 900 } });
    const errors: string[] = []; const dialogs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route('http://app.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto('http://app.test/calls');
    await page.addScriptTag({ content: bundle });
    await page.evaluate((o) => (window as unknown as { __startPublish: (x: unknown) => void }).__startPublish(o), { pending: opts.pending });
    await page.waitForSelector('[data-testid="publish-results"]');
    const requests = () => page.evaluate(() => (window as unknown as { __publishRequests: { method: string; body: { action?: string } }[] }).__publishRequests);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, requests, overflow };
  }

  it('what will go out (how many emails, per result), the messages with their subjects, and a button that stays off until the name of the call is typed', async () => {
    const { page, errors } = await open();
    const summary = await page.locator('[data-testid="publish-summary"]').innerText();
    expect(summary).toContain('4 emails');
    expect(summary).toContain('1 Selected · 2 Not selected · 1 Waiting list');
    expect(await page.locator('[data-testid="message-advance"]').innerText()).toContain(`${NAME}: Selected`);
    expect(await page.locator('[data-testid="confirm-sentence"]').innerText()).toBe('Publish results for 4 applicants? This cannot be undone.');
    expect(await page.locator('[data-testid="publish-button"]').isDisabled()).toBe(true);
    await page.locator('[data-testid="confirm-name"]').fill('Seed Call');
    expect(await page.locator('[data-testid="publish-button"]').isDisabled()).toBe(true);
    await page.locator('[data-testid="confirm-name"]').fill('  seed call 2027 ');
    expect(await page.locator('[data-testid="publish-button"]').isDisabled()).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('an application without a decision blocks publishing, says so, and leads back to Prepare', async () => {
    const { page } = await open({ pending: true });
    expect(await page.locator('[data-testid="blocker-pending"]').innerText()).toContain('1 application has no decision yet.');
    await page.locator('[data-testid="confirm-name"]').fill(NAME);
    expect(await page.locator('[data-testid="publish-button"]').isDisabled()).toBe(true);
    await page.locator('[data-testid="blocker-pending"] button').click();
    expect(await page.title()).toBe('went-to-prepare');
    await page.close();
  }, 120_000);

  it('"Send me a test" says where it went', async () => {
    const { page, requests } = await open();
    await page.locator('[data-testid="send-test"]').click();
    await page.waitForSelector('[data-testid="publish-notice"]');
    expect(await page.locator('[data-testid="publish-notice"]').innerText()).toBe('Sent 3 test emails to a•••@ablute.pt. They carry example data and go to nobody else.');
    expect((await requests()).filter((r) => r.method === 'POST').map((r) => r.body.action)).toEqual(['test']);
    await page.close();
  }, 120_000);

  it('Publish: the confirmation is in the page (no browser dialog); afterwards it says when, the decisions are fixed, and the emails are listed with their state', async () => {
    const { page, dialogs, requests } = await open();
    await page.locator('[data-testid="confirm-name"]').fill(NAME);
    await page.locator('[data-testid="publish-button"]').click();
    await page.waitForSelector('[data-testid="published-box"]');
    expect(await page.locator('[data-testid="published-box"]').innerText()).toContain('4 applicants were told their result');
    expect(await page.locator('[data-testid="published-box"]').innerText()).toContain('The decisions of this phase are now fixed.');
    expect(await page.locator('[data-testid="publish-box"]').count()).toBe(0);                                   // it cannot be published again from here
    expect((await page.locator('[data-testid="send-counts"]').innerText()).replace(/\s+/g, ' ')).toBe('Waiting: 1 Sent: 2 Bounced: 1 Failed: 0');
    expect(await page.locator('[data-testid="send-row"]').count()).toBe(4);
    expect(dialogs).toEqual([]);
    expect((await requests()).filter((r) => r.method === 'POST').map((r) => r.body.action)).toEqual(['publish']);
    await page.close();
  }, 120_000);

  it('the emails: filter by state, "Send again" for one (it becomes Sent), and "Send the waiting emails now"', async () => {
    const { page } = await open();
    await page.locator('[data-testid="confirm-name"]').fill(NAME);
    await page.locator('[data-testid="publish-button"]').click();
    await page.waitForSelector('[data-testid="send-rows"]');
    await page.locator('[data-testid="send-filter"]').selectOption('bounced');
    expect(await page.locator('[data-testid="send-row"]').count()).toBe(1);
    expect(await page.locator('[data-testid="send-row"]').innerText()).toContain('Invalid recipient address');
    await page.locator('[data-testid="resend"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="send-counts"]')!.textContent!.includes('Bounced: 0'));
    await page.locator('[data-testid="send-filter"]').selectOption('all');
    expect(await page.locator('[data-testid="send-row"][data-status="sent"]').count()).toBe(3);
    await page.locator('[data-testid="send-waiting"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="send-counts"]')!.textContent!.includes('Waiting: 0'));
    expect(await page.locator('[data-testid="send-row"][data-status="sent"]').count()).toBe(4);
    expect(await page.locator('[data-testid="send-waiting"]').count()).toBe(0);
    await page.close();
  }, 120_000);

  it('Schedule: needs a date and time; the sentence says when and that nothing is sent until then; the schedule can be cancelled and the screen goes back', async () => {
    const { page, requests } = await open();
    await page.locator('[data-testid="mode-later"]').check();
    await page.locator('[data-testid="confirm-name"]').fill(NAME);
    expect(await page.locator('[data-testid="publish-button"]').isDisabled()).toBe(true);                       // no time chosen yet
    await page.locator('[data-testid="schedule-at"]').fill('2027-03-01T09:30');
    expect(await page.locator('[data-testid="confirm-sentence"]').innerText()).toMatch(/^Schedule the results for 4 applicants on .*2027.*\? Nothing is sent until then\.$/);
    expect(await page.locator('[data-testid="publish-button"]').isDisabled()).toBe(false);
    await page.locator('[data-testid="publish-button"]').click();
    await page.waitForSelector('[data-testid="scheduled-box"]');
    expect(await page.locator('[data-testid="scheduled-box"]').innerText()).toContain('Until then nothing can be changed.');
    expect(await page.locator('[data-testid="publish-box"]').count()).toBe(0);
    const sched = (await requests()).find((r) => r.body.action === 'schedule')!;
    expect(sched.body).toMatchObject({ confirmName: NAME });
    expect((sched.body as unknown as { at: string }).at).toBe('2027-03-01T09:30:00.000Z');                       // Lisbon in March is UTC
    await page.locator('[data-testid="cancel-schedule"]').click();
    await page.waitForSelector('[data-testid="publish-box"]');
    expect(await page.locator('[data-testid="scheduled-box"]').count()).toBe(0);
    await page.close();
  }, 120_000);

  it('nothing is wider than the screen at 375, 768 and 1280, before and after publishing', async () => {
    for (const width of [375, 768, 1280]) {
      const { page, overflow, errors } = await open({ width, pending: true });
      expect(await overflow(), `${width} before`).toBeLessThanOrEqual(0);
      if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `results-publish-${width}.png`), fullPage: true });
      await page.close();
      const done = await open({ width });
      await done.page.locator('[data-testid="confirm-name"]').fill(NAME);
      await done.page.locator('[data-testid="publish-button"]').click();
      await done.page.waitForSelector('[data-testid="send-rows"]');
      expect(await done.overflow(), `${width} after`).toBeLessThanOrEqual(0);
      const tooWide = await done.page.evaluate(() => { const vw = document.documentElement.clientWidth; return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="publish-results"] *')).filter((e) => e.getBoundingClientRect().right > vw + 1).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)); });
      expect(tooWide, `${width}`).toEqual([]);
      if (process.env.SHOTS_DIR) await done.page.screenshot({ path: path.join(process.env.SHOTS_DIR, `results-published-${width}.png`), fullPage: true });
      expect(errors).toEqual([]);
      await done.page.close();
    }
  }, 180_000);
});
