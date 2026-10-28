// Prompt 922 (I2) — the distribution screen in a REAL browser (the real DistributionPanel bundled with rolldown; its API answered by a small in-memory stand-in): the mode, the summary, the load of each
// evaluator, who evaluates what with the state of each, applications that lack evaluators, conflicts with the reason only the administrator sees, "Redistribute…" showing a PREVIEW in the page before anything is
// applied, assigning and removing by hand only where the mode allows, "not available yet", and nothing wider than the screen at 1280/768/375 px. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DistributionMode, DistributionView } from '@/lib/calls/eval-assign-store';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://distribution.test';
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-922-i2');

const view = (over: Partial<DistributionView> = {}): DistributionView => ({
  mode: 'auto', evaluatorsPerApplication: 2, effectiveN: 2, warning: null, unassigned: 0,
  evaluators: [
    { userId: 'u1', name: 'Rita Almeida', email: 'rita@fund.com', assigned: 3, started: 1, submitted: 1 },
    { userId: 'u2', name: 'Bruno Costa with_a_very_long_unbroken_name_that_cannot_wrap_anywhere_1234567890', email: 'bruno@fund.com', assigned: 2, started: 0, submitted: 0 },
    { userId: 'u3', name: null, email: 'carla@fund.com', assigned: 3, started: 0, submitted: 0 },
  ],
  applications: [
    { applicationId: 'a1', reference: 'REF-001', startupName: 'Acme Robotics', needed: 0, short: false, evaluators: [{ userId: 'u1', name: 'Rita Almeida', source: 'auto', status: 'submitted' }, { userId: 'u3', name: 'carla@fund.com', source: 'auto', status: 'not_started' }] },
    { applicationId: 'a2', reference: 'REF-002', startupName: 'Blue Health', needed: 1, short: true, evaluators: [{ userId: 'u2', name: 'Bruno Costa', source: 'manual', status: 'in_progress' }] },
    { applicationId: 'a3', reference: 'REF-003', startupName: null, needed: 2, short: true, evaluators: [] },
  ],
  conflicts: [
    { applicationId: 'a1', reference: 'REF-001', userId: 'u2', evaluator: 'Bruno Costa', text: 'has the same company email domain as a member of the startup', kind: 'auto', note: null, createdAt: null, resolved: true },
    { applicationId: 'a2', reference: 'REF-002', userId: 'u3', evaluator: 'carla@fund.com', text: 'declared a conflict', kind: 'declared', note: 'I advised this startup last year and cannot be impartial.', createdAt: '2026-10-27T10:00:00Z', resolved: true },
  ],
  ...over,
});

describe.skipIf(!CHROME)('the distribution screen (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'distribution-panel-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/distribution-panel.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `distribution-panel-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  function server(initial: DistributionView = view(), opts: { unavailable?: boolean } = {}) {
    const state = { view: initial, posts: [] as Record<string, unknown>[] };
    return {
      state,
      handle: (method: string, body: Record<string, unknown> | null): { status: number; body: unknown } => {
        if (opts.unavailable) return { status: 503, body: { ok: false, code: 'not_available', error: 'Evaluation is not available yet. It will be switched on shortly.' } };
        if (method === 'GET') return { status: 200, body: { ok: true, ...state.view } };
        state.posts.push(body ?? {});
        if (body?.action === 'mode') { state.view = { ...state.view, mode: body.mode as DistributionMode }; return { status: 200, body: { ok: true, ...state.view } }; }
        if (body?.action === 'preview') {
          return { status: 200, body: { ok: true, manual: state.view.mode === 'manual', warning: null, loads: {}, newConflicts: 0,
            remove: [{ applicationId: 'a2', reference: 'REF-002', userId: 'u3', evaluator: 'carla@fund.com', why: 'conflict of interest' }],
            add: [{ applicationId: 'a2', reference: 'REF-002', userId: 'u1', evaluator: 'Rita Almeida' }, { applicationId: 'a3', reference: 'REF-003', userId: 'u2', evaluator: 'Bruno Costa' }],
            keptWithConflict: [{ applicationId: 'a1', reference: 'REF-001', userId: 'u1', evaluator: 'Rita Almeida' }],
            shortfalls: [{ applicationId: 'a3', reference: 'REF-003', wanted: 2, got: 1 }] } };
        }
        if (body?.action === 'redistribute') { state.view = { ...state.view, applications: state.view.applications.map((a) => ({ ...a, short: false, needed: 0 })) }; return { status: 200, body: { ok: true, added: 2, removed: 1, ...state.view } }; }
        if (body?.action === 'assign' || body?.action === 'unassign') {
          if (state.view.mode === 'auto') return { status: 409, body: { ok: false, error: 'The distribution is automatic. Switch to “Mixed” or “Manual” to assign by hand.' } };
          return { status: 200, body: { ok: true, ...state.view } };
        }
        return { status: 400, body: { ok: false } };
      },
    };
  }

  async function open(width: number, srv: ReturnType<typeof server>) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 700 });
    const errors: string[] = []; const dialogs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` });
      const raw = route.request().postData();
      const r = srv.handle(route.request().method(), raw ? JSON.parse(raw) : null);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as { __startDistribution: () => void }).__startDistribution());
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, overflow };
  }
  const ready = (page: import('playwright').Page) => page.waitForSelector('[data-testid="distribution"]');

  it('shows the mode, the summary, the load of each evaluator, who evaluates what with its state, what is short, and the conflicts with the reason only the administrator sees', async () => {
    const { page, errors } = await open(1280, server());
    await ready(page);
    expect(await page.locator('[data-testid="mode-auto"]').isChecked()).toBe(true);
    expect((await page.locator('[data-testid="distribution-summary"]').innerText()).replace(/\s+/g, ' ')).toContain('3 applications to evaluate · 3 evaluators · 2 evaluators per application');
    expect(await page.locator('[data-testid="evaluator-load"]').first().innerText()).toContain('3 assigned · 1 started · 1 submitted');
    expect(await page.locator('[data-testid="distribution-application"]').count()).toBe(3);
    expect(await page.locator('[data-testid="distribution-application"]').first().innerText()).toContain('Rita Almeida · submitted');
    expect(await page.locator('[data-testid="application-short"]').allInnerTexts()).toEqual(['⚠ needs 1 more evaluator', '⚠ needs 2 more evaluators']);
    expect(await page.locator('[data-testid="conflict"]').count()).toBe(2);
    expect(await page.locator('[data-testid="conflict-note"]').innerText()).toContain('Reason given (only you see this): “I advised this startup last year');
    expect(await page.locator('[data-testid="unassign"]').count()).toBe(0);                      // automatic: no hand moves
    expect(await page.locator('[data-testid="assign-select"]').count()).toBe(0);
    await page.screenshot({ path: path.join(SHOTS, 'distribution-1280.png'), fullPage: true });
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('switching the mode saves it; Mixed and Manual show the hand controls (assign, take off — only where nothing was started); an automatic refusal is shown in the page', async () => {
    const srv = server();
    const { page, dialogs } = await open(1280, srv);
    await ready(page);
    await page.locator('[data-testid="mode-mixed"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="assign-select"]').length > 0);
    expect(srv.state.posts[0]).toEqual({ action: 'mode', mode: 'mixed' });
    expect(await page.locator('[data-testid="assign-select"]').count()).toBe(3);
    expect(await page.locator('[data-testid="unassign"]').count()).toBe(1);                      // only Carla's (not started); Rita submitted and Bruno is in progress
    await page.locator('[data-testid="distribution-application"]').nth(2).locator('[data-testid="assign-select"]').selectOption('u1');
    await page.waitForFunction(() => true);
    expect(srv.state.posts.at(-1)).toEqual({ action: 'assign', applicationId: 'a3', userId: 'u1' });
    await page.locator('[data-testid="unassign"]').first().click();
    expect(srv.state.posts.at(-1)).toEqual({ action: 'unassign', applicationId: 'a1', userId: 'u3' });
    // a refusal from the server (somebody switched the call to Automatic meanwhile) is shown in the page, not swallowed
    srv.state.view = { ...srv.state.view, mode: 'auto' };
    await page.locator('[data-testid="distribution-application"]').nth(2).locator('[data-testid="assign-select"]').selectOption('u2');
    await page.waitForSelector('[data-testid="distribution-error"]');
    expect(await page.locator('[data-testid="distribution-error"]').innerText()).toContain('The distribution is automatic');
    await page.locator('[data-testid="mode-auto"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="assign-select"]').length === 0);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('"Redistribute…" shows what would change IN the page (who is taken off, who gets what, conflicts kept, who is short) and applies only on "Apply"; "Cancel" changes nothing', async () => {
    const srv = server();
    const { page, dialogs } = await open(1280, srv);
    await ready(page);
    await page.locator('[data-testid="redistribute"]').click();
    await page.waitForSelector('[data-testid="distribution-preview"]');
    expect(await page.locator('[data-testid="preview-remove"]').innerText()).toContain('− carla@fund.com is taken off REF-002 (conflict of interest)');
    expect(await page.locator('[data-testid="preview-add"]').innerText()).toContain('+ Rita Almeida gets REF-002');
    expect(await page.locator('[data-testid="preview-kept"]').innerText()).toContain('already started the evaluation: it stays');
    expect(await page.locator('[data-testid="preview-short"]').innerText()).toContain('REF-003 would have 1 of 2 evaluators');
    expect(srv.state.posts.map((p) => p.action)).toEqual(['preview']);                          // nothing applied yet
    await page.screenshot({ path: path.join(SHOTS, 'preview-1280.png'), fullPage: true });
    await page.locator('[data-testid="preview-cancel"]').click();
    expect(await page.locator('[data-testid="distribution-preview"]').count()).toBe(0);
    expect(srv.state.posts.map((p) => p.action)).toEqual(['preview']);
    await page.locator('[data-testid="redistribute"]').click();
    await page.locator('[data-testid="preview-apply"]').click();
    await page.waitForSelector('[data-testid="distribution-notice"]');
    expect(srv.state.posts.map((p) => p.action)).toEqual(['preview', 'preview', 'redistribute']);
    expect(await page.locator('[data-testid="application-short"]').count()).toBe(0);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('empty states say what to do; N larger than the team shows the warning; a person without "Configure call" cannot change the mode; before the migration it says it is not available yet', async () => {
    const a = await open(1280, server(view({ evaluators: [], applications: [], conflicts: [], warning: '5 evaluators per application were asked for but only 0 people can evaluate: nobody can be assigned yet.' })));
    await ready(a.page);
    expect(await a.page.locator('[data-testid="no-evaluators"]').innerText()).toContain('Evaluate assigned applications');
    expect(await a.page.locator('[data-testid="no-applications"]').innerText()).toContain('once its eligibility is Fit');
    expect(await a.page.locator('[data-testid="distribution-warning"]').innerText()).toContain('nobody can be assigned yet');
    expect(await a.page.locator('[data-testid="redistribute"]').isDisabled()).toBe(true);
    await a.page.close();
    const b = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await b.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div></body></html>` });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...view() }) });
    });
    await b.goto(`${ORIGIN}/`); await b.addScriptTag({ content: bundle });
    await b.evaluate(() => (window as unknown as { __startDistribution: (o: { canManage: boolean }) => void }).__startDistribution({ canManage: false }));
    await b.waitForSelector('[data-testid="distribution"]');
    expect(await b.locator('[data-testid="mode-manual"]').isDisabled()).toBe(true);
    expect(await b.locator('[data-testid="redistribute"]').isDisabled()).toBe(true);
    await b.close();
    const c = await open(1280, server(view(), { unavailable: true }));
    await c.page.waitForSelector('[data-testid="distribution-loading"]');
    expect(await c.page.locator('[data-testid="distribution-loading"]').innerText()).toBe('Evaluation is not available yet. It will be switched on shortly.');
    await c.page.close();
  }, 120_000);

  it('nothing is wider than the screen at 1280, 768 and 375 — long names, every state, the preview open (screenshots kept)', async () => {
    for (const width of [1280, 768, 375]) {
      const srv = server(view({ mode: 'mixed' }));
      const { page, overflow } = await open(width, srv);
      await ready(page);
      expect(await overflow(), `${width}px`).toBeLessThanOrEqual(0);
      await page.locator('[data-testid="redistribute"]').click();
      await page.waitForSelector('[data-testid="distribution-preview"]');
      expect(await overflow(), `${width}px, preview`).toBeLessThanOrEqual(0);
      const bad = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="distribution"]') as HTMLElement; const r = root.getBoundingClientRect(); const out: string[] = [];
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) { const b = el.getBoundingClientRect(); if (b.width === 0) continue; if (b.right > r.right + 0.5 || b.left < r.left - 0.5) out.push(`${el.tagName}.${String(el.className).slice(0, 30)}`); }
        return out;
      });
      expect(bad, `${width}px`).toEqual([]);
      if (width !== 1280) await page.screenshot({ path: path.join(SHOTS, `distribution-${width}.png`), fullPage: true });
      await page.close();
    }
  }, 240_000);
});
