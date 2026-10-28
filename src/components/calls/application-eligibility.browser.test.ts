// Prompt 918 (I3) — the eligibility of one application in a REAL browser (the real ApplicationEligibility): the result in words with the evidence, a correction that asks for a reason IN the page and sends
// exactly what the server expects, the exception checkbox, "Reclassify", "Flag" for whoever cannot correct, "Retry" after a technical failure, and nothing wider than the screen at 1280/768/375.
// Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EligibilityInfo } from '@/lib/calls/eligibility-payload';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://panel.test';
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-918-i3');

const info = (over: Partial<EligibilityInfo> = {}): EligibilityInfo => ({
  state: 'not_fit', reason: 'Issued on 2026-01-12: older than the 3 months allowed. “Amount you are raising”: 900 000 € is outside the limit.', source: 'engine', rulesVersion: 2, error: null, reclassified: null,
  rules: [
    { ruleId: 'r-num', kind: 'number', sentence: 'Applicants who state 500 000 € or less in “Amount you are raising” are eligible — exactly 500 000 € is eligible.', engine: 'fail', effective: 'fail', reason: '“Amount you are raising”: 900 000 € is outside the limit.', evidence: null, override: null },
    { ruleId: 'r-doc', kind: 'doc_valid', sentence: 'The document in “Permanent Certificate” must be issued within the last 3 months, showing the same company name as declared.', engine: 'fail', effective: 'fail',
      reason: 'Issued on 2026-01-12: older than the 3 months allowed.', evidence: { fileName: 'certidao-permanente-acme-robotics-lda-with-a_very_long_unbroken_file_name_1234567890.pdf', page: 1, quote: 'Certidão emitida em 12/01/2026. Válida até 12/07/2026.' }, override: null },
  ],
  ...over,
});

describe.skipIf(!CHROME)('the eligibility of one application (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-elig-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/application-eligibility.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `app-elig-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(width: number, opts: { info?: EligibilityInfo; canCorrect?: boolean; canFlag?: boolean } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 700 });
    const errors: string[] = []; const dialogs: string[] = []; const posted: Record<string, unknown>[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` });
      posted.push(JSON.parse(route.request().postData() ?? '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    // the component posts to a relative address: answer it on this origin
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate((o) => (window as unknown as { __startPanel: (x: unknown) => void }).__startPanel(o), { info: opts.info ?? info(), canCorrect: opts.canCorrect ?? true, canFlag: opts.canFlag ?? true });
    await page.waitForSelector('[data-testid="eligibility-panel"]');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const changed = () => page.evaluate(() => (window as unknown as { __changed: number }).__changed);
    return { page, errors, dialogs, posted, overflow, changed };
  }

  it('shows the state, the reason and, for a document, the file, the page and the quote', async () => {
    const { page } = await open(1280);
    expect(await page.locator('[data-testid="eligibility-state"]').innerText()).toBe('Not a fit');
    expect(await page.locator('[data-testid="eligibility-reason"]').innerText()).toContain('older than the 3 months allowed');
    expect(await page.locator('[data-testid="rule-evidence"]').innerText()).toContain('page 1');
    expect(await page.locator('[data-testid="rule-evidence"]').innerText()).toContain('Certidão emitida em 12/01/2026');
    expect(await page.locator('[data-testid="rule-outcome"]').allInnerTexts()).toEqual(['Not met', 'Not met']);
    await page.close();
  }, 120_000);

  it('correcting a rule asks for the reason IN the page, sends what the server expects, and tells the screen to reload', async () => {
    const { page, posted, changed, dialogs } = await open(1280);
    await page.locator('[data-testid="rule-mark-met"]').first().click();
    await page.locator('[data-testid="eligibility-confirm"]').click();                                  // no reason: refused in the page
    expect(await page.locator('[data-testid="eligibility-error"]').innerText()).toContain('a correction always has a reason');
    expect(posted).toHaveLength(0);
    await page.locator('[data-testid="eligibility-why"]').fill('The board approved this amount as an exception');
    await page.locator('[data-testid="eligibility-exception"]').check();
    await page.locator('[data-testid="eligibility-confirm"]').click();
    await page.waitForFunction(() => (window as unknown as { __changed: number }).__changed === 1);
    expect(posted).toEqual([{ action: 'correct_rule', ruleId: 'r-num', outcome: 'pass', justification: 'The board approved this amount as an exception', callException: true }]);
    expect(await changed()).toBe(1);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('reclassify (with a reason); a person who cannot correct can only flag, with the reason; a technical failure offers "Retry"', async () => {
    const a = await open(1280);
    await a.page.locator('[data-testid="reclassify-fit"]').click();
    await a.page.locator('[data-testid="eligibility-why"]').fill('Read the certificate: it is the right one');
    await a.page.locator('[data-testid="eligibility-confirm"]').click();
    await a.page.waitForFunction(() => (window as unknown as { __changed: number }).__changed === 1);
    expect(a.posted[0]).toEqual({ action: 'reclassify', status: 'fit', justification: 'Read the certificate: it is the right one', callException: false });
    await a.page.close();

    const f = await open(1280, { canCorrect: false, canFlag: true, info: info({ state: 'fit', reason: 'Meets every eligibility rule.', rules: [] }) });
    expect(await f.page.locator('[data-testid="rule-mark-met"], [data-testid="reclassify-notfit"]').count()).toBe(0);
    await f.page.locator('[data-testid="flag"]').click();
    expect(await f.page.locator('[data-testid="eligibility-exception"]').count()).toBe(0);                // a flag is not a correction
    await f.page.locator('[data-testid="eligibility-why"]').fill('Looks like a duplicate of another startup');
    await f.page.locator('[data-testid="eligibility-confirm"]').click();
    await f.page.waitForFunction(() => (window as unknown as { __changed: number }).__changed === 1);
    expect(f.posted[0]).toEqual({ action: 'flag', reason: 'Looks like a duplicate of another startup' });
    await f.page.close();

    const t = await open(1280, { info: info({ state: 'technical_failure', reason: 'The automatic check could not run. It was not counted against the applicant; a person can retry it.', rules: [], source: null, rulesVersion: null }) });
    expect(await t.page.locator('[data-testid="eligibility-reason"]').innerText()).toContain('not counted against the applicant');
    await t.page.locator('[data-testid="eligibility-retry"]').click();
    await t.page.waitForFunction(() => (window as unknown as { __changed: number }).__changed === 1);
    expect(t.posted[0]).toEqual({ action: 'retry' });
    await t.page.close();
  }, 180_000);

  it('a person\'s decision is shown next to what the platform said; nothing is wider than the screen at 1280, 768 and 375', async () => {
    const overridden = info({ state: 'fit', source: 'human', rules: info().rules.map((r) => ({ ...r, effective: 'pass' as const, override: { outcome: 'pass' as const, by: 'ana', why: 'Board exception', at: '2026-10-27T10:00:00Z' } })) });
    for (const width of [1280, 768, 375]) {
      const { page, overflow } = await open(width, { info: overridden });
      expect(await page.locator('[data-testid="rule-override"]').first().innerText()).toContain('The platform said “Not met”; a person decided “Met”');
      expect(await overflow(), `${width}px`).toBeLessThanOrEqual(0);
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${width}-panel.png`), fullPage: true });
      await page.locator('[data-testid="reclassify-notfit"]').click();
      const bad = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="eligibility-panel"]') as HTMLElement; const r = root.getBoundingClientRect(); const out: string[] = [];
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) { const b = el.getBoundingClientRect(); if (b.width === 0) continue; if (b.right > r.right + 0.5 || b.left < r.left - 0.5) out.push(`${el.tagName}.${String(el.className).slice(0, 30)}`); }
        return out;
      });
      expect(bad, `${width}px`).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `${width}-panel-reclassify.png`), fullPage: true });
      await page.close();
    }
  }, 180_000);
});
