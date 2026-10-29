// Prompt 923 — Setup only for whoever may "Configure call", in a REAL browser (the real CallEditor, bundled with rolldown; the server is a stub that answers what the call's state says and refuses the
// rest). Whoever cannot configure: the Setup tab is not there; the call opens on Applications (if they may view them all) or on Evaluation (their own evaluations), in a draft as in an open call; a link
// straight to Setup — a step, or an old ?tab= — goes to that tab with a short note, and the address is rewritten to where they are; no request to the server is a write. An administrator still sees Setup
// and opens on it. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));

type Access = { configure: boolean; viewApplications: boolean; evaluate: boolean; publishResults?: boolean; handleContestations?: boolean; status: string };
const ADMIN: Access = { configure: true, viewApplications: true, evaluate: true, publishResults: true, handleContestations: true, status: 'draft' };
const ANALYST: Access = { configure: false, viewApplications: true, evaluate: false, status: 'draft' };
const EVALUATOR: Access = { configure: false, viewApplications: false, evaluate: true, status: 'draft' };

describe.skipIf(!CHROME)('the call editor opens on a tab the person can use (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-editor-access-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/call-editor-access.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `call-editor-access-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  /** `search` is what the address says when the editor opens (the editor reads it once). The page is served from a made-up host so that history.replaceState works. */
  async function open(access: Access, search = '', width = 1280) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://app.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto(`http://app.test/calls${search}`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate((a) => (window as unknown as { __startEditor: (o: unknown) => void }).__startEditor(a), access);
    await page.waitForSelector('[data-testid="main-tabs"]');
    await page.waitForTimeout(250);
    const tabs = () => page.locator('[data-testid="main-tabs"] [role="tab"]').allInnerTexts();
    const selected = () => page.locator('[data-testid="main-tabs"] [role="tab"][aria-selected="true"]').innerText();
    const note = async () => ((await page.locator('[data-testid="setup-restricted-note"]').count()) ? page.locator('[data-testid="setup-restricted-note"]').innerText() : null);
    const requests = () => page.evaluate(() => (window as unknown as { __requests: string[] }).__requests);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, tabs, selected, note, requests, overflow };
  }

  it('an administrator: four tabs, Setup among them, a draft opens on Setup, no note', async () => {
    const { page, tabs, selected, note, errors } = await open(ADMIN);
    expect(await tabs()).toEqual(['Setup', 'Applications', 'Evaluation', 'Results']);
    expect(await selected()).toBe('Setup');
    expect(await note()).toBeNull();
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('somebody who may only view the applications: no Setup tab; the call opens on Applications, a draft or a published one, with no note', async () => {
    for (const status of ['draft', 'open']) {
      const { page, tabs, selected, note, errors } = await open({ ...ANALYST, status });
      expect(await tabs(), status).toEqual(['Applications', 'Evaluation']);
      expect(await selected(), status).toBe('Applications');
      expect(await note(), status).toBeNull();
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 120_000);

  it('somebody who only evaluates: no Setup tab; the call opens on Evaluation, and what it shows is their own evaluations (not the board)', async () => {
    for (const status of ['draft', 'open']) {
      const { page, tabs, selected, note, errors } = await open({ ...EVALUATOR, status });
      expect(await tabs(), status).toEqual(['Applications', 'Evaluation']);
      expect(await selected(), status).toBe('Evaluation');
      expect(await note(), status).toBeNull();
      await page.waitForSelector('[data-testid="evaluation-tab"]');
      expect(await page.locator('[data-testid="evaluation-view-board"]').count()).toBe(0);
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 120_000);

  it('a direct link to Setup — a step, section=setup, or an old ?tab= — goes to the tab they can use, with a short note, and the address follows', async () => {
    const links = ['?section=setup&step=form', '?section=setup', '?step=eligibility', '?tab=form&call=call-1', '?tab=preview&call=call-1'];
    for (const link of links) {
      const a = await open(ANALYST, link);
      expect(await a.selected(), link).toBe('Applications');
      expect(await a.note(), link).toBe('Setup is only for people who can configure this call, so this opened Applications instead.');
      expect(await a.page.evaluate(() => window.location.search), link).toContain('section=applications');
      expect(await a.page.evaluate(() => window.location.search), link).not.toContain('setup');
      await a.page.close();
      const e = await open(EVALUATOR, link);
      expect(await e.selected(), link).toBe('Evaluation');
      expect(await e.note(), link).toBe('Setup is only for people who can configure this call, so this opened Evaluation instead.');
      await e.page.close();
    }
  }, 180_000);

  it('the note goes away when they move to another tab, and there is no way back to Setup; the same link opens the step for an administrator', async () => {
    const e = await open(EVALUATOR, '?section=setup&step=form');
    expect(await e.note()).not.toBeNull();
    await e.page.locator('[data-testid="tab-applications"]').click();
    expect(await e.note()).toBeNull();
    expect(await e.page.locator('[data-testid="tab-setup"]').count()).toBe(0);
    await e.page.close();
    const a = await open(ADMIN, '?section=setup&step=form');
    expect(await a.selected()).toBe('Setup');
    expect(await a.note()).toBeNull();
    expect(await a.page.evaluate(() => window.location.search)).toContain('step=form');
    await a.page.close();
  }, 120_000);

  it('they never send a write to the server, and nothing is wider than the screen at 375, 768 and 1280', async () => {
    for (const width of [375, 768, 1280]) {
      const { page, requests, overflow } = await open(EVALUATOR, '?section=setup&step=form', width);
      expect((await requests()).filter((r) => !r.startsWith('GET ')), `${width}`).toEqual([]);
      expect(await overflow(), `${width}`).toBeLessThanOrEqual(0);
      await page.close();
    }
  }, 120_000);
});
