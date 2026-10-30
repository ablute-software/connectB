// Prompt 922 (Adenda 1, B) — the Evaluation grid step with the form beside it, in a REAL browser (the real EvalGridStep bundled with rolldown; its API answered by a small in-memory server built on the real parsers and the
// real view builder): "Based on these answers" (the questions listed by page with their number), the side panel "Form questions" on a wide screen and a tab on a phone, each question showing the criteria it is
// linked to, "Score automatically from answers" with a table of points for every kind of closed question (an incomplete one is said, a new scale clears points that no longer fit), a link proposed from an imported
// document that is applied only when the administrator accepts it, a criterion that came from a template asking to be linked, and a link to a question that left the form. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseCriteriaPayload, parseSettingsPayload, type Criterion, type GridSettings } from '@/lib/calls/eval-grid';
import { buildGridView } from '@/lib/calls/eval-grid-view';
import type { FormField } from '@/lib/calls/types';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://evalgridlinks.test';
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-922-adenda1');

const F = (id: string, kind: FormField['kind'], label: string, page: number, position: number, options: string[] = []): FormField => ({
  id, page, position, kind, label, instruction: null, required: false, options: options.map((o, i) => ({ id: `${id}-o${i}`, label: o })), validations: {}, condition: null, platformMapping: null, expectedType: null, maxAgeMonths: null,
});
const FIELDS: FormField[] = [
  F('f-stage', 'single_choice', 'Stage of the company', 1, 0, ['Pre-seed', 'Seed', 'Series A']),
  F('f-grant', 'yes_no', 'Have you received a grant?', 1, 1),
  F('f-raised', 'number', 'Investment received so far', 2, 0),
  F('f-team', 'long_text', 'Describe your team and its experience', 2, 1),
  F('f-deck', 'file', 'Pitch deck', 3, 0),
];

describe.skipIf(!CHROME)('the evaluation grid linked to the form (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-grid-links-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/eval-grid-step.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `eval-grid-links-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  const crit = (over: Partial<Criterion> & { name: string }): Criterion => ({ id: `c${Math.random().toString(16).slice(2, 9)}-0000-4000-8000-000000000001`, section: null, position: 0, guidance: '', weight: 50, format: 'scale', scaleMin: 1, scaleMax: 5, levels: [], commentRequired: false, minScore: null, linkedFields: [], auto: null, linkNotice: false, ...over });

  function server(initial: Criterion[] = [], extra: { suggestions?: Record<string, string[]>; template?: Criterion[] } = {}) {
    const state = { criteria: initial, settings: { ...DEFAULT_SETTINGS, divergence: { ...DEFAULT_SETTINGS.divergence }, deadlines: [] } as GridSettings, rev: 0, puts: [] as { criteria: Criterion[] }[] };
    const view = () => buildGridView({ status: 'draft', version: 1, rev: state.rev, criteria: state.criteria, settings: state.settings, evaluations: { started: 0, submitted: 0 }, phases: [], fields: FIELDS });
    return {
      state,
      handle: (method: string, url: string, body: Record<string, unknown> | null): { status: number; body: unknown } => {
        if (url.endsWith('/eval-grid/import')) return { status: 200, body: { ok: true, runId: 'run-1', notice: 'x', fileName: 'grid.pdf', proposal: { criteria: [{ name: 'Team and experience', source: { line: 1, text: 'Team and experience' } }], notes: [] }, criteria: [{ name: 'Team and experience', weight: 100, scaleMin: 1, scaleMax: 5, levels: [], guidance: '', section: null, commentRequired: false, minScore: null }], suggestions: extra.suggestions ?? {} } };
        if (url.endsWith('/eval-grid/templates')) return { status: 200, body: { ok: true, templates: extra.template ? [{ id: 't1', name: 'Seed grid', criteria: extra.template.length }] : [] } };
        if (/\/eval-grid\/templates\/[^/]+$/.test(url) && method === 'POST') return { status: 200, body: { ok: true, name: 'Seed grid', criteria: extra.template ?? [] } };
        if (method === 'GET') return { status: 200, body: { ok: true, canManage: true, ...view() } };
        const parsed = parseCriteriaPayload(body?.criteria, { fields: FIELDS });
        if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
        const ps = parseSettingsPayload(body?.settings, []);
        if (!ps.ok) return { status: 400, body: { ok: false, error: ps.error } };
        state.puts.push({ criteria: parsed.criteria }); state.criteria = parsed.criteria; state.settings = ps.settings; state.rev += 1;
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
    await page.waitForSelector('[data-testid="eval-grid-step"]');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, overflow };
  }

  it('1280 px: the form is beside the grid; a criterion is based on questions chosen from a list by page; the panel shows who looks at what and what is left over', async () => {
    const srv = server();
    const { page, errors, dialogs, overflow } = await open(1280, srv);
    await page.locator('[data-testid="add-criterion"]').click();
    const card = page.locator('[data-testid="criterion-card"]').first();
    await card.locator('textarea').first().fill('Team');
    await card.locator('[data-testid="criterion-weight"]').fill('100');
    expect(await page.locator('[data-testid="form-questions"]').isVisible()).toBe(true);
    expect(await page.locator('[data-testid="form-question"]').count()).toBe(5);
    expect(await page.locator('[data-testid="form-questions-summary"]').innerText()).toBe('5 of 5 questions are not linked to any criterion.');
    await card.locator('[data-testid="criterion-link-open"]').click();
    const list = card.locator('[data-testid="criterion-link-list"]');
    expect(await list.innerText()).toMatch(/Page 1[\s\S]*1\. Stage of the company[\s\S]*2\. Have you received a grant\?[\s\S]*Page 2[\s\S]*3\. Investment received so far[\s\S]*4\. Describe your team and its experience[\s\S]*Page 3[\s\S]*5\. Pitch deck \(document\)/i);
    await list.locator('[data-testid="link-f-team"]').check();
    await list.locator('[data-testid="link-f-deck"]').check();
    expect(await card.locator('[data-testid="criterion-link"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))).toEqual(['4. Describe your team and its experience×', '5. Pitch deck×']);
    expect(await page.locator('[data-testid="form-questions-summary"]').innerText()).toBe('3 of 5 questions are not linked to any criterion.');
    expect(await page.locator('[data-testid="form-question"][data-field="f-team"] [data-testid="form-question-criterion"]').allInnerTexts()).toEqual(['Team']);
    expect(await page.locator('[data-testid="form-question"][data-field="f-stage"]').getAttribute('data-linked')).toBe('false');
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(srv.state.criteria[0].linkedFields).toEqual(['f-team', 'f-deck']);
    // unlinking is one click on the chip
    await card.locator('[data-testid="criterion-unlink"]').first().click();
    expect(await card.locator('[data-testid="criterion-link"]').count()).toBe(1);
    await page.screenshot({ path: path.join(SHOTS, 'grid-form-panel-1280.png'), fullPage: true });
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]); expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('score automatically: a table of points for a single choice, with every answer needed; a number is read in ranges; a new scale clears the points that no longer fit; saved as built', async () => {
    const srv = server();
    const { page, errors } = await open(1280, srv);
    await page.locator('[data-testid="add-criterion"]').click();
    const card = page.locator('[data-testid="criterion-card"]').first();
    await card.locator('textarea').first().fill('Stage');
    await card.locator('[data-testid="criterion-weight"]').fill('100');
    await card.locator('[data-testid="auto-toggle"]').check();
    expect(await card.locator('[data-testid="auto-field"] option').allInnerTexts()).toEqual(['1. Stage of the company', '2. Have you received a grant?', '3. Investment received so far']);        // only closed questions
    expect(await card.locator('[data-testid="criterion-link"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))).toEqual(['1. Stage of the company']);                                                                              // the question is linked by itself, and stays
    expect(await card.locator('[data-testid="criterion-unlink"]').count()).toBe(0);
    expect(await card.locator('[data-testid="auto-problems"]').innerText()).toContain('give points to the answer “Pre-seed”');
    const ids = await card.locator('select[data-testid^="ap-"]').evaluateAll((els) => els.map((e) => e.id));
    expect(ids).toHaveLength(3);
    await card.locator(`#${ids[0]}`).selectOption('1');
    await card.locator(`#${ids[1]}`).selectOption('3');
    expect(await card.locator('[data-testid="auto-problems"]').innerText()).toContain('“Series A”');
    await card.locator(`#${ids[2]}`).selectOption('5');
    expect(await card.locator('[data-testid="auto-problems"]').count()).toBe(0);
    await card.locator('[data-testid="auto-override"]').check();
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(srv.state.criteria[0].auto).toMatchObject({ fieldId: 'f-stage', kind: 'single_choice', options: { 'f-stage-o0': 1, 'f-stage-o1': 3, 'f-stage-o2': 5 }, override: true });
    // a smaller scale: the points that no longer fit go back to "no points yet" and the step says so
    await card.locator('[data-testid="criterion-scale"]').selectOption('custom');
    await card.locator('[data-testid="criterion-max"]').fill('3');
    expect(await card.locator('[data-testid="auto-problems"]').innerText()).toContain('“Series A”');
    expect(await card.locator(`#${ids[2]}`).inputValue()).toBe('');
    expect(await card.locator(`#${ids[1]}`).inputValue()).toBe('3');
    // a number: ranges, the last without a limit
    await card.locator('[data-testid="auto-field"]').selectOption('f-raised');
    expect(await card.locator('[data-testid="auto-range"]').count()).toBe(1);
    await card.locator('[data-testid="auto-add-range"]').click();
    await card.locator('[data-testid="auto-limit-0"]').fill('50000');
    await card.locator('[data-testid="auto-add-range"]').click();
    await card.locator('[data-testid="auto-limit-1"]').fill('250000');
    expect(await card.locator('[data-testid="auto-range"]').allInnerTexts()).toEqual(expect.arrayContaining([expect.stringContaining('over 250 000')]));
    const sel = await card.locator('select[data-testid^="ap-"]').evaluateAll((els) => els.map((e) => e.id));
    expect(sel).toHaveLength(3);
    for (const [i, v] of ['1', '2', '3'].entries()) await card.locator(`#${sel[i]}`).selectOption(v);
    expect(await card.locator('[data-testid="auto-problems"]').count()).toBe(0);
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(srv.state.criteria[0].auto).toMatchObject({ fieldId: 'f-raised', kind: 'number', ranges: [{ upTo: 50000, points: 1 }, { upTo: 250000, points: 2 }, { upTo: null, points: 3 }] });
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('Yes/No and multiple choice have their own tables; the form is shown whole on a phone as a tab, with nothing sideways', async () => {
    const srv = server([crit({ name: 'Grant', weight: 100, linkedFields: ['f-grant'], auto: { fieldId: 'f-grant', kind: 'yes_no', options: {}, yes: null, no: null, ranges: [], multi: 'sum', override: false } })]);
    const { page, overflow, errors } = await open(375, srv);
    const card = page.locator('[data-testid="criterion-card"]').first();
    expect(await card.locator('select[data-testid^="ap-"]').count()).toBe(2);
    expect(await page.locator('[data-testid="form-questions"]').isVisible()).toBe(false);                        // the panel is a tab here
    await page.locator('[data-testid="grid-tab-questions"]').click();
    expect(await page.locator('[data-testid="form-questions"]').isVisible()).toBe(true);
    expect(await page.locator('[data-testid="criterion-card"]').first().isVisible()).toBe(false);
    expect(await page.locator('[data-testid="form-question"][data-field="f-grant"] [data-testid="form-question-criterion"]').allInnerTexts()).toEqual(['Grant']);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(SHOTS, 'grid-form-tab-375.png'), fullPage: true });
    await page.locator('[data-testid="grid-tab-build"]').click();
    expect(await page.locator('[data-testid="criterion-card"]').first().isVisible()).toBe(true);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 768, height: 1000 });
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('a proposed link from an imported document is applied only when accepted; a criterion from a template asks to be linked; a link to a question that left the form can be removed', async () => {
    const srv = server([], { suggestions: { 'Team and experience': ['f-team'] }, template: [crit({ name: 'Vision', weight: 100, linkNotice: true })] });
    const { page, errors } = await open(1280, srv);
    await page.locator('[data-testid="grid-import-file"]').setInputFiles({ name: 'grid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await page.waitForSelector('[data-testid="criterion-suggestion"]');
    expect(await page.locator('[data-testid="criterion-link"]').count()).toBe(0);                                   // nothing is linked until the administrator says so
    expect(await page.locator('[data-testid="criterion-suggestion"]').innerText()).toContain('4. Describe your team and its experience');
    await page.locator('[data-testid="criterion-suggestion-accept"]').click();
    expect(await page.locator('[data-testid="criterion-link"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))).toEqual(['4. Describe your team and its experience×']);
    expect(await page.locator('[data-testid="criterion-suggestion"]').count()).toBe(0);
    // a template
    await page.locator('[data-testid="grid-template-select"]').selectOption('t1');
    await page.waitForSelector('[data-testid="criterion-link-notice"]');
    expect(await page.locator('[data-testid="criterion-link-notice"]').innerText()).toBe('Link this criterion to the questions of this call.');
    await page.locator('[data-testid="criterion-link-open"]').click();
    await page.locator('[data-testid="link-f-stage"]').check();
    expect(await page.locator('[data-testid="criterion-link-notice"]').count()).toBe(0);
    await page.close();
    // a question that was removed from the form
    const gone = server([crit({ name: 'Old', weight: 100, linkedFields: ['f-removed', 'f-team'] })]);
    const o = await open(1280, gone);
    expect(await o.page.locator('[data-testid="criterion-link"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))).toEqual(['A question that was removed from the form×', '4. Describe your team and its experience×']);
    expect(await o.page.locator('[data-testid="grid-save"]').isDisabled()).toBe(true);
    await o.page.locator('[data-testid="criterion-unlink"]').first().click();
    await o.page.locator('[data-testid="grid-save"]').click();
    await o.page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(gone.state.criteria[0].linkedFields).toEqual(['f-team']);
    expect([...errors, ...o.errors]).toEqual([]);
    await o.page.close();
  }, 120_000);
});
