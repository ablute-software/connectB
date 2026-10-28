// Prompt 922 (I1) — the Evaluation grid step in a REAL browser (the real EvalGridStep bundled with rolldown; its API answered by a small in-memory server built on the real parsers, the real view builder and the
// real document reader): add criteria with different scales, the live sum of the weights, the preview "as the evaluator sees it" (a grade ring that changes with the scores), import from an Excel file with
// the source of each criterion shown, templates, removing a criterion (asked in the page), the frozen state asking before it makes a version, "not available yet", and no sideways scroll at 1280/768/375 px.
// Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseCriteriaPayload, parseSettingsPayload, type Criterion, type GridSettings } from '@/lib/calls/eval-grid';
import { buildGridView } from '@/lib/calls/eval-grid-view';
import { readGridDocument } from '@/lib/calls/eval-grid-import';
import { proposalToCriteria } from '@/lib/calls/eval-grid-reader';
import type { CallStatus } from '@/lib/calls/types';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://evalgrid.test';
const PHASES = [{ id: '20000000-0000-4000-8000-000000000001', name: 'First screening' }, { id: '20000000-0000-4000-8000-000000000002', name: 'Pitch day' }];
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-922-i1');

describe.skipIf(!CHROME)('the evaluation grid step (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  let xlsxPath = '';
  let reading: Awaited<ReturnType<typeof readGridDocument>>;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-grid-step-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/eval-grid-step.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `eval-grid-step-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    // the Excel file an entity might upload, read by the platform's own reader (the stub returns what the real route would)
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Criterion', 'Weight', 'Scale'], ['Team', 40, '1-5'], ['Market size', 35, '0-10'], ['Traction', 25, '1-5']]), 'Grid');
    const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    xlsxPath = path.join(os.tmpdir(), `eval-grid-${process.pid}.xlsx`); fs.writeFileSync(xlsxPath, bytes);
    reading = await readGridDocument('grid.xlsx', bytes);
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); fs.rmSync(xlsxPath, { force: true }); }, 60_000);

  function server(opts: { status?: CallStatus; submitted?: number; started?: number; unavailable?: boolean; templates?: { id: string; name: string; criteria: number }[] } = {}) {
    const state = {
      criteria: [] as Criterion[], settings: { ...DEFAULT_SETTINGS, divergence: { ...DEFAULT_SETTINGS.divergence }, deadlines: [] } as GridSettings, rev: 0, version: 1,
      status: opts.status ?? 'draft' as CallStatus, puts: [] as unknown[], templates: [...(opts.templates ?? [])], savedTemplates: [] as string[], importRun: null as string | null,
    };
    const view = () => buildGridView({ status: state.status, version: state.version, rev: state.rev, criteria: state.criteria, settings: state.settings, evaluations: { started: opts.started ?? opts.submitted ?? 0, submitted: opts.submitted ?? 0 }, phases: PHASES });
    return {
      state,
      handle: (method: string, url: string, body: Record<string, unknown> | null): { status: number; body: unknown } => {
        if (opts.unavailable) return { status: 503, body: { ok: false, code: 'not_available', error: 'Evaluation is not available yet. It will be switched on shortly.' } };
        if (url.endsWith('/eval-grid/import')) {
          if (!reading.ok) return { status: 422, body: { ok: false, error: reading.error } };
          state.importRun = 'run-1';
          return { status: 200, body: { ok: true, runId: 'run-1', notice: 'Read on our platform only. Evaluation grids are never sent to an AI provider.', fileName: 'grid.xlsx', proposal: reading.proposal, criteria: proposalToCriteria(reading.proposal) } };
        }
        if (url.endsWith('/eval-grid/templates')) {
          if (method === 'POST') { state.savedTemplates.push(String(body?.name)); state.templates.push({ id: `t${state.templates.length + 1}`, name: String(body?.name), criteria: state.criteria.length }); return { status: 200, body: { ok: true, id: 't', templates: state.templates } }; }
          return { status: 200, body: { ok: true, templates: state.templates } };
        }
        if (/\/eval-grid\/templates\/[^/]+$/.test(url) && method === 'POST') {
          return { status: 200, body: { ok: true, name: 'Portugal Ventures 2027', criteria: [{ id: 'x1', section: null, position: 0, name: 'Vision', guidance: '', weight: 60, format: 'scale', scaleMin: 1, scaleMax: 5, levels: [], commentRequired: false, minScore: null }, { id: 'x2', section: null, position: 1, name: 'Execution', guidance: '', weight: 40, format: 'scale', scaleMin: 1, scaleMax: 5, levels: [], commentRequired: false, minScore: null }] } };
        }
        if (method === 'GET') return { status: 200, body: { ok: true, canManage: true, ...view() } };
        state.puts.push(body);
        const parsed = parseCriteriaPayload(body?.criteria);
        if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
        const ps = parseSettingsPayload(body?.settings, PHASES.map((p) => p.id));
        if (!ps.ok) return { status: 400, body: { ok: false, error: ps.error } };
        if ((opts.submitted ?? 0) > 0 && body?.confirm !== true) return { status: 409, body: { ok: false, code: 'needs_confirm', evaluations: opts.submitted, nextVersion: state.version + 1, error: `${opts.submitted} evaluations were already submitted on version ${state.version}. This change makes version ${state.version + 1}; those evaluations keep theirs. Continue?` } };
        if ((opts.submitted ?? 0) > 0) state.version += 1;
        state.criteria = parsed.criteria; state.settings = ps.settings; state.rev += 1;
        return { status: 200, body: { ok: true, ...view() } };
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
      const isJson = (route.request().headers()['content-type'] ?? '').includes('json');
      const r = srv.handle(route.request().method(), url.pathname, raw && isJson ? JSON.parse(raw) : null);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as { __startGrid: () => void }).__startGrid());
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, overflow };
  }
  const ready = (page: import('playwright').Page) => page.waitForSelector('[data-testid="eval-grid-step"]');

  async function addCriterion(page: import('playwright').Page, name: string, weight: string, scale?: string) {
    await page.locator('[data-testid="add-criterion"]').click();
    const card = page.locator('[data-testid="criterion-card"]').last();
    await card.locator('textarea').first().fill(name);
    await card.locator('[data-testid="criterion-weight"]').fill(weight);
    if (scale) await card.locator('[data-testid="criterion-scale"]').selectOption(scale);
    return card;
  }

  it('builds a grid: criteria with different scales, the live sum of the weights (⚠ until 100 %), saved, and the call state hears about it', async () => {
    const srv = server();
    const { page, errors, dialogs, overflow } = await open(1280, srv);
    await ready(page);
    expect(await page.locator('[data-testid="no-criteria"]').count()).toBe(1);
    expect(await page.locator('[data-testid="grid-privacy"]').innerText()).toBe('Read on our platform only. Evaluation grids are never sent to an AI provider.');
    await addCriterion(page, 'Team', '25');
    expect(await page.locator('[data-testid="grid-weights"]').innerText()).toContain('⚠ Sum of the weights: 25 % — 75 % missing');
    const tech = await addCriterion(page, 'Technology', '25', '0-10');
    expect(await tech.locator('[data-testid="criterion-minscore"] option').count()).toBe(11);          // none + 1..10
    await addCriterion(page, 'Market', '50', '1-5');
    expect(await page.locator('[data-testid="grid-weights"]').innerText()).toContain('Sum of the weights: 100 % ✓');
    expect(await page.locator('[data-testid="grid-dirty"]').count()).toBe(1);
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(srv.state.criteria.map((c) => [c.name, c.weight, c.scaleMin, c.scaleMax])).toEqual([['Team', 25, 1, 5], ['Technology', 25, 0, 10], ['Market', 50, 1, 5]]);
    expect(await page.evaluate(() => (window as unknown as { __count: number }).__count)).toBe(3);
    await page.screenshot({ path: path.join(SHOTS, 'grid-1280.png'), fullPage: true });
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('a custom scale, a description of the levels, the eliminatory minimum, "comment required"; the settings: any number of evaluators, "all", blind, a deadline per phase', async () => {
    const srv = server();
    const { page } = await open(1280, srv);
    await ready(page);
    const c = await addCriterion(page, 'Impact', '100', 'custom');
    await c.locator('[data-testid="criterion-min"]').fill('0');
    await c.locator('[data-testid="criterion-max"]').fill('20');
    await c.locator('[data-testid="criterion-levels"] summary').click();
    await c.locator('[data-testid="criterion-levels"] textarea').fill('20: outstanding\n0–5: weak');
    await c.locator('[data-testid="criterion-minscore"]').selectOption('3');
    await c.locator('[data-testid="criterion-comment-required"]').check();
    await page.locator('[data-testid="set-evaluators"]').fill('25');
    await page.locator('[data-testid="set-blind"]').check();
    await page.locator('input[aria-label="Deadline for Pitch day"]').fill('2026-12-15');
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(srv.state.criteria[0]).toMatchObject({ scaleMin: 0, scaleMax: 20, minScore: 3, commentRequired: true, levels: [{ from: 20, to: 20, text: 'outstanding' }, { from: 0, to: 5, text: 'weak' }] });
    expect(srv.state.settings).toMatchObject({ evaluatorsPerApplication: 25, blind: true, deadlines: [{ phaseId: PHASES[1].id, day: '2026-12-15' }] });
    await page.locator('[data-testid="set-all"]').check();
    expect(await page.locator('[data-testid="set-evaluators"]').isDisabled()).toBe(true);
    await page.close();
  }, 120_000);

  it('"As the evaluator sees it": the grade ring changes with the scores, the level text shows, an eliminatory minimum flags — and nothing is saved by playing with it', async () => {
    const srv = server();
    const { page } = await open(1280, srv);
    await ready(page);
    await addCriterion(page, 'Team', '60');
    const second = await addCriterion(page, 'Market', '40');
    await second.locator('[data-testid="criterion-minscore"]').selectOption('2');
    await page.locator('[data-testid="criterion-levels"]').first().locator('summary').click();
    await page.locator('[data-testid="criterion-levels"]').first().locator('textarea').fill('5: excellent team');
    await page.locator('[data-testid="grid-tab-preview"]').click();
    await page.waitForSelector('[data-testid="evaluator-preview"]');
    expect(await page.locator('[data-testid="preview-criterion"]').count()).toBe(2);
    const ring = page.locator('[data-testid="grade-ring-text"]');
    const before = await ring.innerText();
    await page.locator('[data-testid="preview-criterion"]').first().getByRole('radio', { name: '5', exact: true }).click();
    await page.locator('[data-testid="preview-criterion"]').nth(1).getByRole('radio', { name: '1', exact: true }).click();
    expect(await ring.innerText()).not.toBe(before);
    expect(await page.locator('[data-testid="preview-level-text"]').first().innerText()).toContain('excellent team');
    expect(await page.locator('[data-testid="preview-flag"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-testid="preview-formula"]').innerText()).toContain('Final grade = weighted average on a 1–5 scale = Team × 60 % + Market × 40 %');
    await page.screenshot({ path: path.join(SHOTS, 'preview-1280.png'), fullPage: true });
    expect(srv.state.puts).toEqual([]);
    await page.close();
  }, 120_000);

  it('import from an Excel file: the criteria come with where each was read; nothing is final until saved; the platform-only notice is on the page', async () => {
    const srv = server();
    const { page, dialogs } = await open(1280, srv);
    await ready(page);
    await page.locator('[data-testid="grid-import-file"]').setInputFiles(xlsxPath);
    await page.waitForSelector('[data-testid="grid-import-review"]');
    expect(await page.locator('[data-testid="criterion-card"]').count()).toBe(3);
    expect(await page.locator('[data-testid="criterion-source"]').first().innerText()).toMatch(/^Read from line \d+: “/);
    expect(await page.locator('[data-testid="grid-weights"]').innerText()).toContain('100 % ✓');
    expect(srv.state.criteria).toHaveLength(0);
    await page.locator('[data-testid="criterion-card"]').first().locator('[data-testid="criterion-weight"]').fill('45');
    await page.locator('[data-testid="criterion-card"]').last().locator('[data-testid="criterion-weight"]').fill('20');
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(srv.state.puts[0]).toMatchObject({ importRunId: 'run-1' });
    expect(srv.state.criteria.map((c) => c.weight)).toEqual([45, 35, 20]);
    expect(dialogs).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'import-1280.png'), fullPage: true });
    await page.close();
  }, 120_000);

  it('templates: "Save as template" asks for a name in the page; "Start from a template" fills the grid with a copy to review', async () => {
    const srv = server({ templates: [{ id: 't1', name: 'Portugal Ventures 2027', criteria: 2 }] });
    const { page, dialogs } = await open(1280, srv);
    await ready(page);
    await page.locator('[data-testid="grid-template-select"]').selectOption('t1');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="criterion-card"]').length === 2);
    expect(srv.state.criteria).toHaveLength(0);                                                      // a copy to review, not saved yet
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    await page.locator('[data-testid="grid-save-template"]').click();
    await page.locator('[data-testid="grid-template-name"]').fill('My own grid');
    await page.locator('[data-testid="grid-template-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-template-form"]').length === 0);
    expect(srv.state.savedTemplates).toEqual(['My own grid']);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('removing a criterion is asked in the page (Keep keeps, Yes removes); reordering moves it', async () => {
    const srv = server();
    const { page, dialogs } = await open(1280, srv);
    await ready(page);
    await addCriterion(page, 'First', '50'); await addCriterion(page, 'Second', '50');
    await page.locator('[data-testid="criterion-card"]').nth(1).getByLabel('Move up').click();
    expect(await page.locator('[data-testid="criterion-card"]').first().locator('textarea').first().inputValue()).toBe('Second');
    await page.locator('[data-testid="criterion-card"]').first().locator('[data-testid="criterion-remove"]').click();
    await page.locator('[data-testid="criterion-remove-no"]').click();
    expect(await page.locator('[data-testid="criterion-card"]').count()).toBe(2);
    await page.locator('[data-testid="criterion-card"]').first().locator('[data-testid="criterion-remove"]').click();
    await page.locator('[data-testid="criterion-remove-yes"]').click();
    expect(await page.locator('[data-testid="criterion-card"]').count()).toBe(1);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('after the first evaluation is submitted the grid is frozen: a change asks, in the page, how many evaluations keep version 1, then makes version 2; the blind option is locked', async () => {
    const srv = server({ status: 'open', submitted: 3 });
    srv.state.criteria = [{ id: 'c-1', section: null, position: 0, name: 'Team', guidance: '', weight: 100, format: 'scale', scaleMin: 1, scaleMax: 5, levels: [], commentRequired: false, minScore: null }];
    const { page, dialogs } = await open(1280, srv);
    await ready(page);
    expect(await page.locator('[data-testid="grid-frozen"]').innerText()).toContain('3 evaluations already submitted');
    expect(await page.locator('[data-testid="set-blind"]').isDisabled()).toBe(true);
    await page.locator('[data-testid="criterion-weight"]').fill('90');
    await page.locator('[data-testid="grid-save"]').click();
    expect(await page.locator('[data-testid="grid-confirm"]').innerText()).toContain('This change makes version 2');
    expect(srv.state.rev).toBe(0);
    await page.locator('[data-testid="grid-confirm-yes"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-confirm"]').length === 0);
    expect(srv.state.version).toBe(2);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('a confirmed call shows the grid read-only with the reason; before the migration the step says it is not available yet instead of an error page', async () => {
    const locked = server({ status: 'validated' });
    const a = await open(1280, locked);
    await ready(a.page);
    expect(await a.page.locator('[data-testid="grid-locked"]').innerText()).toContain('Edit configuration');
    expect(await a.page.locator('[data-testid="add-criterion"]').count()).toBe(0);
    await a.page.close();
    const off = server({ unavailable: true });
    const b = await open(1280, off);
    await b.page.waitForSelector('[data-testid="grid-loading"]');
    expect(await b.page.locator('[data-testid="grid-loading"]').innerText()).toBe('Evaluation is not available yet. It will be switched on shortly.');
    await b.page.close();
  }, 120_000);

  it('nothing is wider than the screen at 1280, 768 and 375 — long names, a custom scale with long level texts, the settings and the preview', async () => {
    for (const width of [1280, 768, 375]) {
      const srv = server();
      const { page, overflow } = await open(width, srv);
      await ready(page);
      const c = await addCriterion(page, 'A very long criterion name with a_very_long_unbroken_word_that_cannot_wrap_anywhere_by_itself_1234567890 and then more words after it', '60', 'custom');
      await c.locator('[data-testid="criterion-levels"] summary').click();
      await c.locator('[data-testid="criterion-levels"] textarea').fill('5: an_extremely_long_unbroken_description_of_the_best_level_that_goes_on_and_on_and_on_1234567890');
      await addCriterion(page, 'Short', '40', '0-10');
      expect(await overflow(), `${width}px, build`).toBeLessThanOrEqual(0);
      const bad = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="eval-grid-step"]') as HTMLElement; const r = root.getBoundingClientRect(); const out: string[] = [];
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) { const b = el.getBoundingClientRect(); if (b.width === 0) continue; if (b.right > r.right + 0.5 || b.left < r.left - 0.5) out.push(`${el.tagName}.${String(el.className).slice(0, 30)}`); }
        return out;
      });
      expect(bad, `${width}px`).toEqual([]);
      if (width !== 1280) await page.screenshot({ path: path.join(SHOTS, `grid-${width}.png`), fullPage: true });
      await page.locator('[data-testid="grid-tab-preview"]').click();
      await page.waitForSelector('[data-testid="evaluator-preview"]');
      expect(await overflow(), `${width}px, preview`).toBeLessThanOrEqual(0);
      if (width !== 1280) await page.screenshot({ path: path.join(SHOTS, `preview-${width}.png`), fullPage: true });
      await page.close();
    }
  }, 240_000);
});
