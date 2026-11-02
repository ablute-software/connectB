// Prompt 922 (Adenda 1, B) — the Evaluation grid step with the form beside it, in a REAL browser (the real EvalGridStep bundled with rolldown; its API answered by a small in-memory server built on the real parsers and the
// real view builder; reworked for Adenda 2 of the 922, 02/11/2026): "Based on these answers" (the questions listed by page with their number), the side panel "Form questions" on a wide screen and a tab on a phone, each question showing the criteria it is
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
const FIELDS_DEFAULT: FormField[] = [
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

  function server(initial: Criterion[] = [], extra: { suggestions?: Record<string, string[]>; template?: Criterion[]; fields?: FormField[] } = {}) {
    const FIELDS = extra.fields ?? FIELDS_DEFAULT;
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

  type Pg = import('playwright').Page;
  const cardAt = (page: Pg, i: number) => page.locator('[data-testid="criterion-card"]').nth(i);
  async function openCard(page: Pg, i: number) {
    const c = cardAt(page, i);
    if ((await c.getAttribute('data-open')) !== 'true') await c.locator('[data-testid="criterion-toggle"]').click();
    return c;
  }
  async function moreOptions(card: import('playwright').Locator) {
    if (!(await card.locator('[data-testid="criterion-more-body"]').count())) await card.locator('[data-testid="criterion-more"]').click();
    return card;
  }
  const picker = (page: Pg) => page.locator('[data-testid="question-picker"]');
  const chips = (c: import('playwright').Locator) => c.locator('[data-testid="criterion-link"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
  async function addNamed(page: Pg, name: string, weight = '100') {
    await page.locator('[data-testid="add-criterion"]').click();
    const card = page.locator('[data-testid="criterion-card"][data-open="true"]');
    await card.locator('textarea').first().fill(name);
    await card.locator('[data-testid="criterion-weight"]').fill(weight);
    return card;
  }
  const many = (n: number): FormField[] => Array.from({ length: n }, (_, i) => F(`q${String(i + 1).padStart(3, '0')}`, i % 5 === 0 ? 'single_choice' : 'long_text', `Question number ${i + 1} about the project and its long_unbroken_word_${'x'.repeat(60)}`, 1 + Math.floor(i / 10), i % 10, i % 5 === 0 ? ['Yes', 'No'] : []));

  it('1280 px: ONE way to link — the button "Link questions" opens a panel with search, filters and the pages folded; the choices become chips on the card; no list of questions stays open beside the grid', async () => {
    const srv = server();
    const { page, errors, dialogs, overflow } = await open(1280, srv);
    const card = await addNamed(page, 'Team');
    expect(await page.locator('[data-testid="form-questions"]').count()).toBe(0);                      // the permanent side panel is gone
    expect(await page.locator('input[type="checkbox"][data-testid^="link-"]').count()).toBe(0);       // …and so is the list of boxes inside the card
    await card.locator('[data-testid="criterion-link-open"]').click();
    await picker(page).waitFor();
    expect(await page.locator('[data-testid="picker-page-group"]').count()).toBe(3);
    expect(await page.locator('[data-testid="picker-question"]').count()).toBe(0);                       // the pages are folded
    expect(await page.locator('[data-testid="picker-count"]').innerText()).toBe('5 of 5 questions · 0 chosen');
    // search by text opens the page where it finds something
    await page.locator('[data-testid="picker-search"]').fill('team');
    expect(await page.locator('[data-testid="picker-question"]').allInnerTexts()).toEqual(['4. Describe your team and its experience']);
    await page.locator('[data-testid="link-f-team"]').check();
    // search by number
    await page.locator('[data-testid="picker-search"]').fill('5');
    expect(await page.locator('[data-testid="picker-question"]').allInnerTexts()).toEqual(['5. Pitch deck (document)']);
    await page.locator('[data-testid="link-f-deck"]').check();
    await page.locator('[data-testid="picker-search"]').fill('');
    expect(await page.locator('[data-testid="picker-question"]').count()).toBe(0);                       // folded again
    // filters: "Linked to this criterion" and a page
    await page.locator('[data-testid="picker-mine"]').click();
    expect(await page.locator('[data-testid="picker-count"]').innerText()).toContain('2 of 5');
    await page.locator('[data-testid="picker-mine"]').click();
    await page.locator('[data-testid="picker-page"]').selectOption('1');
    expect(await page.locator('[data-testid="picker-question"]').allInnerTexts()).toEqual(['1. Stage of the company', '2. Have you received a grant?']);
    await page.locator('[data-testid="picker-page"]').selectOption('');
    await page.locator('[data-testid="picker-not-linked"]').click();
    expect(await page.locator('[data-testid="picker-count"]').innerText()).toContain('3 of 5');          // the two chosen are not "not linked" any more
    await page.screenshot({ path: path.join(SHOTS, 'link-questions-1280.png') });
    await page.locator('[data-testid="picker-done"]').click();
    expect(await picker(page).count()).toBe(0);
    expect(await chips(card)).toEqual(['4. Describe your team and its experience×', '5. Pitch deck×']);
    expect(await card.locator('[data-testid="criterion-summary"]').innerText()).toContain('2 questions');
    expect(await page.locator('[data-testid="form-coverage"]').innerText()).toBe('Form coverage (2 / 5)');
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(srv.state.criteria[0].linkedFields).toEqual(['f-team', 'f-deck']);
    // a chip is unlinked with its ✕
    const again = await openCard(page, 0);
    await again.locator('[data-testid="criterion-unlink"]').first().click();
    expect(await chips(again)).toEqual(['5. Pitch deck×']);
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]); expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('"Form coverage (n / N)" opens the same list only to look, with "Not linked yet" on by default, and says which criteria each question is linked to', async () => {
    const srv = server([crit({ name: 'Team', weight: 100, linkedFields: ['f-team'] })]);
    const { page } = await open(1280, srv);
    expect(await page.locator('[data-testid="form-coverage"]').innerText()).toBe('Form coverage (1 / 5)');
    expect(await page.locator('[data-testid="grid-coverage"]').innerText()).toBe('1 of 5 questions linked');
    await page.locator('[data-testid="form-coverage"]').click();
    await picker(page).waitFor();
    expect(await page.locator('[data-testid="picker-not-linked"]').getAttribute('aria-pressed')).toBe('true');
    await page.locator('[data-testid="picker-page-toggle"]').first().click();
    expect(await page.locator('[data-testid="picker-page-group"]').count()).toBe(3);                    // the page with the linked question has nothing "not linked"… it is listed by what is left
    expect(await page.locator('[data-testid="picker-linked-to"]').allInnerTexts()).toEqual(expect.arrayContaining(['not linked']));
    expect(await page.locator('input[type="checkbox"]').count()).toBe(0);                               // only to look
    await page.locator('[data-testid="picker-not-linked"]').click();                                     // show all
    await page.locator('[data-testid="picker-search"]').fill('team');
    expect(await page.locator('[data-testid="picker-linked-to"]').innerText()).toBe('→ Team');
    await page.locator('[data-testid="picker-done"]').click();
    expect(await picker(page).count()).toBe(0);
    await page.close();
  }, 120_000);

  it('cards are folded (one line each), one open at a time, with Collapse all / Expand all; "More options" holds the rest; "How the evaluation runs" is folded at the top', async () => {
    const srv = server([crit({ name: 'Team', weight: 40 }), crit({ name: 'Market', weight: 30, linkedFields: ['f-stage', 'f-team'] }), crit({ name: 'Traction', weight: 20 })]);
    const { page } = await open(1280, srv);
    expect(await page.locator('[data-testid="criterion-card"][data-open="true"]').count()).toBe(0);
    expect(await page.locator('[data-testid="criterion-summary"]').allInnerTexts()).toEqual(['40 % · scale 1–5 · no questions linked', '30 % · scale 1–5 · 2 questions', '20 % · scale 1–5 · no questions linked']);
    expect(await page.locator('[data-testid="grid-settings"]').count()).toBe(0);
    expect(await page.locator('[data-testid="grid-weights"]').innerText()).toContain('⚠ Weights: 90 / 100 %');
    await cardAt(page, 0).locator('[data-testid="criterion-toggle"]').click();
    await cardAt(page, 1).locator('[data-testid="criterion-toggle"]').click();
    expect(await page.locator('[data-testid="criterion-card"][data-open="true"]').count()).toBe(1);   // opening one closes the other
    expect(await cardAt(page, 1).getAttribute('data-open')).toBe('true');
    const c = cardAt(page, 1);
    expect(await c.locator('[data-testid="criterion-more-body"]').count()).toBe(0);                    // guidance, levels, section… hidden by default
    expect(await c.locator('[data-testid="criterion-minscore"]').count()).toBe(0);
    expect(await chips(c)).toEqual(['1. Stage of the company×', '4. Describe your team and its experience×']);
    await c.locator('[data-testid="criterion-more"]').click();
    expect(await c.locator('[data-testid="criterion-minscore"]').count()).toBe(1);
    await page.locator('[data-testid="expand-all"]').click();
    expect(await page.locator('[data-testid="criterion-card"][data-open="true"]').count()).toBe(3);
    await page.locator('[data-testid="collapse-all"]').click();
    expect(await page.locator('[data-testid="criterion-card"][data-open="true"]').count()).toBe(0);
    // the help text: one short line, the long one behind a "?"
    const k = await openCard(page, 2);
    await moreOptions(k);
    expect(await k.locator('[data-testid="help-text"]').count()).toBe(0);
    await k.locator('[data-testid="help-toggle"]').first().click();
    expect(await k.locator('[data-testid="help-text"]').count()).toBe(1);
    await page.close();
  }, 120_000);

  it('"Create from questions": five questions give five criteria, each linked to its question, with equal weights that add up to 100 % — and the new sum is shown', async () => {
    const fields = many(5);
    const srv = server([], { fields });
    const { page } = await open(1280, srv);
    await page.locator('[data-testid="create-from-questions"]').click();
    await picker(page).waitFor();
    expect(await page.locator('[data-testid="picker-create"]').isDisabled()).toBe(true);
    for (const t of await page.locator('[data-testid="picker-page-toggle"]').all()) await t.click();
    for (const f of fields) await page.locator(`[data-testid="link-${f.id}"]`).check();
    expect(await page.locator('[data-testid="picker-create"]').innerText()).toBe('Create 5 criteria');
    await page.locator('[data-testid="picker-create"]').click();
    expect(await picker(page).count()).toBe(0);
    expect(await page.locator('[data-testid="criterion-card"]').count()).toBe(5);
    expect(await page.locator('[data-testid="criterion-title"]').first().innerText()).toMatch(/^1\. Question number 1 about the project/);
    expect(await page.locator('[data-testid="grid-weights"]').innerText()).toBe('Weights: 100 / 100 % ✓');
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(srv.state.criteria.map((c) => c.weight)).toEqual([20, 20, 20, 20, 20]);
    expect(srv.state.criteria.map((c) => c.linkedFields)).toEqual(fields.map((f) => [f.id]));
    // an uneven split: 3 questions → 33.34 / 33.33 / 33.33 (the rounding goes to the first)
    const srv3 = server([], { fields: many(3) });
    const b = await open(1280, srv3);
    await b.page.locator('[data-testid="create-from-questions"]').click();
    for (const t of await b.page.locator('[data-testid="picker-page-toggle"]').all()) await t.click();
    for (const f of many(3)) await b.page.locator(`[data-testid="link-${f.id}"]`).check();
    await b.page.locator('[data-testid="picker-create"]').click();
    await b.page.locator('[data-testid="grid-save"]').click();
    await b.page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(srv3.state.criteria.map((c) => c.weight)).toEqual([33.34, 33.33, 33.33]);
    await b.page.close();
    await page.close();
  }, 180_000);

  it('60 questions: the panel loads by parts and scrolls inside itself; nothing is wider than the panel or the screen, at 1280 and at 375 (where the panel is the whole screen)', async () => {
    const fields = many(60);
    for (const width of [1280, 375]) {
      const srv = server([crit({ name: 'Team', weight: 100 })], { fields });
      const { page, overflow } = await open(width, srv);
      const card = await openCard(page, 0);
      await card.locator('[data-testid="criterion-link-open"]').click();
      await picker(page).waitFor();
      for (const t of await page.locator('[data-testid="picker-page-toggle"]').all()) await t.click();
      expect(await page.locator('[data-testid="picker-question"]').count()).toBe(30);                    // by parts, never all 60 at once
      expect(await page.locator('[data-testid="picker-more"]').innerText()).toBe('Show more (30 left)');
      await page.locator('[data-testid="picker-more"]').click();
      expect(await page.locator('[data-testid="picker-question"]').count()).toBe(60);
      const box = await page.locator('[data-testid="question-picker"] > div').boundingBox();
      if (width === 375) expect(Math.round(box!.width)).toBe(375);                                        // the whole screen on a phone
      else expect(box!.width).toBeLessThanOrEqual(448 + 1);                                               // a side panel on a computer
      const listOk = await page.evaluate(() => { const l = document.querySelector('[data-testid="picker-list"]') as HTMLElement; return { scrolls: l.scrollHeight > l.clientHeight, inside: document.documentElement.scrollHeight <= window.innerHeight + 1 }; });
      expect(listOk).toEqual({ scrolls: true, inside: true });                                            // the list scrolls inside the panel; the page does not grow
      const bad = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="question-picker"] > div') as HTMLElement; const r = root.getBoundingClientRect(); const out: string[] = [];
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) { const b = el.getBoundingClientRect(); if (b.width === 0) continue; if (b.right > r.right + 0.5 || b.left < r.left - 0.5) out.push(`${el.tagName}.${String(el.className).slice(0, 30)}`); }
        return out;
      });
      expect(bad, `${width}px`).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `link-questions-60-${width}.png`) });
      await page.locator('[data-testid="picker-done"]').click();
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.close();
    }
  }, 240_000);

  it('score automatically (in More options): a table of points for a single choice, with every answer needed; a number is read in ranges; a new scale clears the points that no longer fit; saved as built', async () => {
    const srv = server();
    const { page, errors } = await open(1280, srv);
    const card = await addNamed(page, 'Stage');
    await moreOptions(card);
    await card.locator('[data-testid="auto-toggle"]').check();
    expect(await card.locator('[data-testid="auto-field"] option').allInnerTexts()).toEqual(['1. Stage of the company', '2. Have you received a grant?', '3. Investment received so far']);        // only closed questions
    expect(await chips(card)).toEqual(['1. Stage of the company']);                                                                                  // the question is linked by itself, and stays
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
    const again = await openCard(page, 0);
    await moreOptions(again);
    await again.locator('[data-testid="criterion-scale"]').selectOption('custom');
    await again.locator('[data-testid="criterion-max"]').fill('3');
    expect(await again.locator('[data-testid="auto-problems"]').innerText()).toContain('“Series A”');
    expect(await again.locator(`#${ids[2]}`).inputValue()).toBe('');
    expect(await again.locator(`#${ids[1]}`).inputValue()).toBe('3');
    // a number: ranges, the last without a limit
    await again.locator('[data-testid="auto-field"]').selectOption('f-raised');
    expect(await again.locator('[data-testid="auto-range"]').count()).toBe(1);
    await again.locator('[data-testid="auto-add-range"]').click();
    await again.locator('[data-testid="auto-limit-0"]').fill('50000');
    await again.locator('[data-testid="auto-add-range"]').click();
    await again.locator('[data-testid="auto-limit-1"]').fill('250000');
    const sel = await again.locator('select[data-testid^="ap-"]').evaluateAll((els) => els.map((e) => e.id));
    expect(sel).toHaveLength(3);
    for (const [i, v] of ['1', '2', '3'].entries()) await again.locator(`#${sel[i]}`).selectOption(v);
    expect(await again.locator('[data-testid="auto-problems"]').count()).toBe(0);
    await page.locator('[data-testid="grid-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(srv.state.criteria[0].auto).toMatchObject({ fieldId: 'f-raised', kind: 'number', ranges: [{ upTo: 50000, points: 1 }, { upTo: 250000, points: 2 }, { upTo: null, points: 3 }] });
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('a proposed link from an imported document is applied only when accepted; a criterion from a template asks to be linked; a link to a question that left the form can be removed; the evaluator\'s rehearsal shows the question and where the answer will appear', async () => {
    const srv = server([], { suggestions: { 'Team and experience': ['f-team'] }, template: [crit({ name: 'Vision', weight: 100, linkNotice: true })] });
    const { page, errors } = await open(1280, srv);
    await page.locator('[data-testid="grid-import-file"]').setInputFiles({ name: 'grid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await page.waitForSelector('[data-testid="grid-import-review"]');
    const card = await openCard(page, 0);
    expect(await card.locator('[data-testid="criterion-link"]').count()).toBe(0);                                // nothing is linked until the administrator says so
    expect(await card.locator('[data-testid="criterion-suggestion"]').innerText()).toContain('4. Describe your team and its experience');
    await card.locator('[data-testid="criterion-suggestion-accept"]').click();
    expect(await chips(card)).toEqual(['4. Describe your team and its experience×']);
    expect(await card.locator('[data-testid="criterion-suggestion"]').count()).toBe(0);
    // the rehearsal: the criterion shows the question (with its number and the whole text) and the stand-in for the answer
    await page.locator('[data-testid="grid-tab-preview"]').click();
    expect(await page.locator('[data-testid="preview-linked-question"]').innerText()).toContain('4. Describe your team and its experience');
    expect(await page.locator('[data-testid="preview-linked-question"]').innerText()).toContain('The applicant’s answer appears here');
    await page.locator('[data-testid="grid-tab-build"]').click();
    // a template
    await page.locator('[data-testid="grid-template-select"]').selectOption('t1');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="criterion-card"]').length === 1);
    expect(await page.locator('[data-testid="criterion-warning"]').innerText()).toContain('link it to the questions');
    const t = await openCard(page, 0);
    expect(await t.locator('[data-testid="criterion-link-notice"]').innerText()).toBe('Link this criterion to the questions of this call.');
    await t.locator('[data-testid="criterion-link-open"]').click();
    await page.locator('[data-testid="picker-search"]').fill('stage');
    await page.locator('[data-testid="link-f-stage"]').check();
    await page.locator('[data-testid="picker-done"]').click();
    expect(await t.locator('[data-testid="criterion-link-notice"]').count()).toBe(0);
    await page.close();
    // a question that was removed from the form
    const gone = server([crit({ name: 'Old', weight: 100, linkedFields: ['f-removed', 'f-team'] })]);
    const o = await open(1280, gone);
    const oc = await openCard(o.page, 0);
    expect(await o.page.locator('[data-testid="criterion-warning"]').innerText()).toContain('a linked question was removed');
    expect(await chips(oc)).toEqual(['A question that was removed from the form×', '4. Describe your team and its experience×']);
    expect(await o.page.locator('[data-testid="grid-save"]').isDisabled()).toBe(true);
    await oc.locator('[data-testid="criterion-unlink"]').first().click();
    await o.page.locator('[data-testid="grid-save"]').click();
    await o.page.waitForFunction(() => document.querySelectorAll('[data-testid="grid-dirty"]').length === 0);
    expect(gone.state.criteria[0].linkedFields).toEqual(['f-team']);
    expect([...errors, ...o.errors]).toEqual([]);
    await o.page.close();
  }, 120_000);

  it('375 px: the card, the folded settings and the bar fit the phone — with six criteria and 54 questions the page stays short, and the screenshot is kept', async () => {
    const fields = many(54);
    const crits = Array.from({ length: 6 }, (_, i) => crit({ name: `Criterion ${i + 1} with a_long_unbroken_word_${'y'.repeat(50)}`, weight: i === 0 ? 20 : 16, linkedFields: [fields[i].id, fields[i + 10].id] }));
    for (const width of [375, 768]) {
      const srv = server(crits, { fields });
      const { page, overflow } = await open(width, srv);
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(h).toBeLessThan(width === 375 ? 2400 : 2000);                                                  // folded cards: the page is short
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(SHOTS, `grid-folded-${width}.png`), fullPage: true });
      const c = await openCard(page, 0);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await c.locator('[data-testid="criterion-more"]').click();
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(SHOTS, `grid-open-${width}.png`), fullPage: true });
      await page.close();
    }
  }, 240_000);
});
