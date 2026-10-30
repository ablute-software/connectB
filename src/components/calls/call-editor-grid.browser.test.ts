// Prompt 922 (Adenda 1, A, 29/10/2026) — "Add a criterion" in the REAL call editor: the grid step is reached through the real CallEditor (its state, its callbacks, its re-renders) and its API is answered by an in-memory
// server built on the real parsers and view builder. Seen on the call "Test": the editor of a new criterion opened and closed by itself — the step reloaded the grid every time the editor re-rendered, and every reload
// replaced what was being typed with what the server had (nothing yet). Here: the grid is read ONCE; three criteria (40/30/30) are added, edited, one removed (confirmed in the page), reordered, and each save is
// what the server holds; the weights not adding up to 100 % never stop the editing (⚠ only); an error shows next to the buttons, in view. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseCriteriaPayload, parseSettingsPayload, type Criterion, type GridSettings } from '@/lib/calls/eval-grid';
import { buildGridView } from '@/lib/calls/eval-grid-view';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://editorgrid.test';
const PHASES = [{ id: '20000000-0000-4000-8000-000000000001', name: 'First screening' }];

describe.skipIf(!CHROME)('adding criteria in the real call editor', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-editor-grid-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/call-editor-grid.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `call-editor-grid-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  function server(opts: { failSaves?: boolean } = {}) {
    const state = { criteria: [] as Criterion[], settings: { ...DEFAULT_SETTINGS, divergence: { ...DEFAULT_SETTINGS.divergence }, deadlines: [] } as GridSettings, rev: 0, gets: 0, puts: 0, callGets: 0, failSaves: !!opts.failSaves };
    const view = () => buildGridView({ status: 'draft', version: 1, rev: state.rev, criteria: state.criteria, settings: state.settings, evaluations: { started: 0, submitted: 0 }, phases: PHASES });
    const call = {
      id: 'call-1', promoterKind: 'catalog_entity', promoterId: 'firm-1', name: 'Test', description: null, opensAt: null, closesAt: null, timezone: 'Europe/Lisbon', visibility: 'listed', limitUnit: 'project', allowMultiple: false,
      contentLanguage: 'en', currency: 'EUR', status: 'draft', linkToken: null, configVersion: 1, validatedAt: null, publishedAt: null, closedAt: null, archivedAt: null, duplicatedFrom: null, createdBy: 'ana',
      createdAt: '2026-10-29T10:00:00Z', updatedAt: '2026-10-29T10:00:00Z', evalGridVersion: 1,
    };
    return {
      state,
      handle: (method: string, pathname: string, body: Record<string, unknown> | null): { status: number; body: unknown } => {
        if (pathname === '/api/calls/call-1' && method === 'GET') {
          state.callGets++;
          return { status: 200, body: {
            ok: true, call, effectiveStatus: 'draft', promoterName: 'zz-test-firm', canManage: true, canManageTeam: true, canViewApplications: true, canEvaluate: true, canPublishResults: true, canHandleContestations: true,
            phases: PHASES.map((p, i) => ({ id: p.id, position: i, name: p.name, startsOn: null, endsOn: null })), fields: [], issues: [], teamMembers: 1, eligibilityRules: 0, evalCriteria: state.criteria.length,
            branding: { coverUrl: null, logoUrl: null, logoSource: null, profileLogoUrl: null }, summary: { phases: 1, pages: 1, fields: 0, questions: 0, documents: 0, required: 0, mapped: 0 },
            actions: { canDelete: true, canArchive: false, status: 'draft' }, applications: { submitted: 0, total: 0 }, events: [],
          } };
        }
        if (pathname === '/api/calls/call-1/eval-grid/templates') return { status: 200, body: { ok: true, templates: [] } };
        if (pathname === '/api/calls/call-1/eval-grid' && method === 'GET') { state.gets++; return { status: 200, body: { ok: true, canManage: true, ...view() } }; }
        if (pathname === '/api/calls/call-1/eval-grid' && method === 'PUT') {
          state.puts++;
          if (state.failSaves) return { status: 500, body: { ok: false, error: 'The grid could not be saved. Please try again.' } };
          const parsed = parseCriteriaPayload(body?.criteria);
          if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
          const ps = parseSettingsPayload(body?.settings, PHASES.map((p) => p.id));
          if (!ps.ok) return { status: 400, body: { ok: false, error: ps.error } };
          state.criteria = parsed.criteria; state.settings = ps.settings; state.rev += 1;
          return { status: 200, body: { ok: true, ...view() } };
        }
        return { status: 404, body: { ok: false } };
      },
    };
  }

  async function open(srv: ReturnType<typeof server>, viewport = { width: 1280, height: 800 }) {
    const page = await browser.newPage({ viewport });
    const errors: string[] = []; const dialogs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/calls') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` });
      const raw = route.request().postData();
      const r = srv.handle(route.request().method(), url.pathname, raw ? JSON.parse(raw) : null);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });
    await page.goto(`${ORIGIN}/calls?section=setup&step=grid`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as { __startEditor: () => void }).__startEditor());
    await page.waitForSelector('[data-testid="eval-grid-step"]');
    return { page, errors, dialogs };
  }
  const add = async (page: import('playwright').Page, name: string, weight: string) => {
    await page.locator('[data-testid="add-criterion"]').click();
    const card = page.locator('[data-testid="criterion-card"]').last();
    await card.locator('textarea').first().fill(name);
    await card.locator('[data-testid="criterion-weight"]').fill(weight);
  };
  const saved = (page: import('playwright').Page) => page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0 && !(document.querySelector('[data-testid="grid-save"]') as HTMLButtonElement | null)?.textContent?.includes('Saving'));

  it('the grid is read ONCE: the step does not reload while the editor re-renders (the cause: a new callback on every render started a new load, which replaced what was being typed)', async () => {
    const srv = server();
    const { page } = await open(srv);
    await page.waitForTimeout(1500);
    expect(srv.state.gets).toBe(1);
    await page.locator('[data-testid="add-criterion"]').click();
    await page.waitForTimeout(1500);
    expect(await page.locator('[data-testid="criterion-card"]').count()).toBe(1);                 // the new criterion is still there
    expect(srv.state.gets).toBe(1);
    await page.close();
  }, 120_000);

  it('an empty grid: three criteria (40/30/30) are added, edited, one removed (asked in the page), reordered — and each save is what the server holds', async () => {
    const srv = server();
    const { page, errors, dialogs } = await open(srv);
    expect(await page.locator('[data-testid="no-criteria"]').count()).toBe(1);
    await add(page, 'Team', '40'); await add(page, 'Market', '30'); await add(page, 'Traction', '30');
    expect(await page.locator('[data-testid="criterion-card"]').count()).toBe(3);
    expect(await page.locator('[data-testid="grid-weights"]').innerText()).toContain('Sum of the weights: 100 % ✓');
    await page.locator('[data-testid="grid-save"]').click(); await saved(page);
    expect(srv.state.criteria.map((c) => [c.name, c.weight])).toEqual([['Team', 40], ['Market', 30], ['Traction', 30]]);
    // edit
    await page.locator('[data-testid="criterion-card"]').nth(1).locator('textarea').first().fill('Market size');
    await page.locator('[data-testid="criterion-card"]').nth(1).locator('[data-testid="criterion-weight"]').fill('25');
    expect(await page.locator('[data-testid="grid-weights"]').innerText()).toContain('⚠');           // 95 %: a warning, never a stop
    await page.locator('[data-testid="grid-save"]').click(); await saved(page);
    expect(srv.state.criteria.map((c) => [c.name, c.weight])).toEqual([['Team', 40], ['Market size', 25], ['Traction', 30]]);
    // remove one: asked in the page
    await page.locator('[data-testid="criterion-card"]').nth(1).locator('[data-testid="criterion-remove"]').click();
    expect(await page.locator('[data-testid="criterion-remove-confirm"]').innerText()).toContain('Remove “Market size”?');
    await page.locator('[data-testid="criterion-remove-yes"]').click();
    await page.locator('[data-testid="grid-save"]').click(); await saved(page);
    expect(srv.state.criteria.map((c) => c.name)).toEqual(['Team', 'Traction']);
    // reorder
    await page.locator('[data-testid="criterion-card"]').nth(0).getByLabel('Move down').click();
    await page.locator('[data-testid="grid-save"]').click(); await saved(page);
    expect(srv.state.criteria.map((c) => c.name)).toEqual(['Traction', 'Team']);
    expect(srv.state.criteria.map((c) => c.position)).toEqual([0, 1]);
    expect(srv.state.gets).toBe(1);                                                                // still one read, after four saves
    expect(dialogs).toEqual([]); expect(errors).toEqual([]);
    await page.close();
  }, 180_000);

  it('the weights not adding up to 100 % never stop the first criterion: it is added, the step says ⚠, and it saves', async () => {
    const srv = server();
    const { page } = await open(srv);
    await add(page, 'Team', '10');
    expect(await page.locator('[data-testid="criterion-card"]').count()).toBe(1);
    expect(await page.locator('[data-testid="grid-weights"]').innerText()).toContain('⚠');
    expect(await page.locator('[data-testid="grid-save"]').isDisabled()).toBe(false);
    await page.locator('[data-testid="grid-save"]').click(); await saved(page);
    expect(srv.state.criteria.map((c) => [c.name, c.weight])).toEqual([['Team', 10]]);
    await page.close();
  }, 120_000);

  it('a failed save says so right next to the buttons, in view without scrolling — and what was typed is kept', async () => {
    const srv = server({ failSaves: true });
    const { page } = await open(srv, { width: 1280, height: 700 });
    await add(page, 'Team', '100');
    await page.locator('[data-testid="grid-save"]').scrollIntoViewIfNeeded();
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForSelector('[data-testid="grid-error-near"]');
    expect(await page.locator('[data-testid="grid-error-near"]').innerText()).toBe('The grid could not be saved. Please try again.');
    const inView = await page.evaluate(() => { const e = document.querySelector('[data-testid="grid-error-near"]')!.getBoundingClientRect(); const b = document.querySelector('[data-testid="grid-save"]')!.getBoundingClientRect(); return { errorVisible: e.top >= 0 && e.bottom <= window.innerHeight, nextToButton: Math.abs(e.top - b.bottom) < 120 || Math.abs(b.top - e.bottom) < 120 }; });
    expect(inView).toEqual({ errorVisible: true, nextToButton: true });
    expect(await page.locator('[data-testid="criterion-card"]').count()).toBe(1);
    expect(await page.locator('[data-testid="grid-dirty"]').count()).toBe(1);
    await page.close();
  }, 120_000);
});
