// Prompt 925 — the selection screens in a REAL browser (the real SelectionRulesStep and SelectionPanel bundled with rolldown; their API answered by small in-memory stand-ins): writing the rules (minimums in the
// unit of the call, places, a budget by what each project asks for, quotas, the tie-break chain), the impossible said as it is written, the preview with invented applications, saving a new version; and on the board
// "Propose selection", the explanation of each application, the ties that block "Apply" until a person orders them, the proposal out of date, nothing wider than the screen at 1280/768/375 px. Without a Chrome
// (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type SelectionRules } from '@/lib/calls/selection';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://selection.test';
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-925');
const crit = (id: string, name: string) => ({ id, section: null, position: 0, name, guidance: '', weight: 50, format: 'scale', scaleMin: 1, scaleMax: 5, levels: [], commentRequired: false, minScore: null });
const FIELDS = [
  { id: 'f-sector', label: 'Main sector of the project, as described in the application form', kind: 'single_choice', options: [{ id: 'health', label: 'Health' }, { id: 'energy', label: 'Energy' }] },
  { id: 'f-ask', label: 'Amount asked (€)', kind: 'number', options: [] },
];

describe.skipIf(!CHROME)('the selection screens (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/selection.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `selection-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  type Handler = (method: string, url: string, body: Record<string, unknown> | null) => { status: number; body: unknown };
  async function open(width: number, start: '__startSelStep' | '__startSelPanel', handle: Handler) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 700 });
    const errors: string[] = []; const dialogs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` });
      const raw = route.request().postData();
      const r = handle(route.request().method(), url.pathname, raw ? JSON.parse(raw) : null);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate((s) => (window as unknown as Record<string, () => void>)[s](), start);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, overflow };
  }

  function rulesServer(initial?: SelectionRules, canEdit = true, lockedReason: string | null = null) {
    const state = { version: initial ? 1 : 0, rules: initial ?? { ...DEFAULT_RULES }, puts: [] as Record<string, unknown>[] };
    const handle: Handler = (method, _url, body) => {
      if (method === 'GET') return { status: 200, body: { ok: true, canEdit, lockedReason, version: state.version, rules: state.rules, criteria: [crit('team', 'Team'), crit('tech', 'Technology')], scoring: { mode: 'weighted', aggregation: 'sum' }, fields: FIELDS } };
      state.puts.push(body ?? {});
      if (body?.baseVersion !== state.version) return { status: 409, body: { ok: false, code: 'conflict', error: 'Someone else changed the selection rules. Reload to see their changes.' } };
      state.rules = body.rules as SelectionRules; state.version += 1;
      return { status: 200, body: { ok: true, version: state.version, rules: state.rules } };
    };
    return { state, handle };
  }

  it('the Setup step: minimums in the unit of the call, places, a budget by the amount asked, a quota, the tie-break chain; the impossible is said at once; the preview shows what the rules do; saving makes a version', async () => {
    const srv = rulesServer();
    const { page, errors, dialogs, overflow } = await open(1280, '__startSelStep', srv.handle);
    await page.waitForSelector('[data-testid="selection-step"]');
    expect(await page.locator('[data-testid="calculation-order"]').isVisible()).toBe(false);             // folded until opened
    await page.locator('summary', { hasText: 'The order of the calculation' }).click();
    expect(await page.locator('[data-testid="calculation-order"] li').count()).toBe(7);
    expect(await page.locator('label[for="sel-min-total"]').innerText()).toContain('%');
    await page.locator('[data-testid="sel-min-total"]').fill('60');
    await page.locator('[data-testid="sel-slots"]').fill('3');
    await page.locator('[data-testid="sel-budget-on"]').check();
    await page.locator('[data-testid="sel-budget-total"]').fill('500000');
    await page.locator('[data-testid="sel-per-asked"]').check();
    await page.locator('[data-testid="sel-asked-field"]').selectOption('f-ask');
    await page.locator('[data-testid="add-quota"]').click();
    expect(await page.locator('[data-testid="quota-option"]').inputValue()).toBe('health');
    await page.locator('[data-testid="quota-min"]').fill('1');
    await page.locator('[data-testid="tie-add"]').selectOption('team');
    await page.locator('[data-testid="tie-add"]').selectOption('tech');
    expect(await page.locator('[data-testid="tie-chain"] li').allInnerTexts()).toEqual(expect.arrayContaining([expect.stringContaining('Team'), expect.stringContaining('Technology'), expect.stringContaining('A person decides')]));
    await page.locator('[data-testid="tie-chain"] li').first().getByRole('button', { name: 'Move down' }).click();
    expect((await page.locator('[data-testid="tie-chain"] li').first().innerText())).toContain('Technology');
    expect(await page.locator('[data-testid="selection-warnings"]').count()).toBe(0);
    expect(await page.locator('[data-testid="preview-row"]').count()).toBe(12);
    expect(await page.locator('[data-testid="preview-summary"]').innerText()).toMatch(/\d+ selected · \d+ on the waiting list · \d+ rejected · budget used/);
    // the impossible, said as it is written
    await page.locator('[data-testid="quota-min"]').fill('4');
    expect(await page.locator('[data-testid="selection-warnings"]').innerText()).toContain('The minimum places of the quotas add up to 4, more than the 3 places.');
    await page.locator('[data-testid="quota-min"]').fill('1');
    await page.screenshot({ path: path.join(SHOTS, 'rules-1280.png'), fullPage: true });
    await page.locator('[data-testid="selection-save"]').click();
    await page.waitForSelector('[data-testid="selection-saved"]');
    expect(await page.locator('[data-testid="selection-saved"]').innerText()).toContain('Version 1');
    const sent = srv.state.puts[0].rules as SelectionRules;
    expect(sent).toMatchObject({ minTotal: 60, slots: 3, budget: { total: 500000, per: 'asked', fieldId: 'f-ask' }, quotas: [{ fieldId: 'f-sector', minSeats: 1, match: { kind: 'option', optionId: 'health' } }] });
    expect(sent.tieBreak).toEqual([{ kind: 'criterion', criterionId: 'tech' }, { kind: 'criterion', criterionId: 'team' }, { kind: 'manual' }]);       // a person always decides what the chain cannot
    expect(await page.evaluate(() => (window as unknown as { __selVersion: number }).__selVersion)).toBe(1);
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]); expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('a locked step (evaluation closed or results published) shows the reason and cannot be edited; a conflict is told', async () => {
    const { page } = await open(1280, '__startSelStep', rulesServer({ ...DEFAULT_RULES, slots: 2 }, false, 'The results were published: the selection rules are fixed.').handle);
    await page.waitForSelector('[data-testid="selection-step"]');
    expect(await page.locator('[data-testid="selection-locked"]').innerText()).toContain('The results were published');
    expect(await page.locator('[data-testid="sel-slots"]').isDisabled()).toBe(true);
    expect(await page.locator('[data-testid="selection-save"]').count()).toBe(0);
    await page.close();
    const stale = rulesServer({ ...DEFAULT_RULES, slots: 2 });
    const { page: p2 } = await open(1280, '__startSelStep', stale.handle);
    await p2.waitForSelector('[data-testid="selection-step"]');
    await p2.locator('[data-testid="sel-slots"]').fill('5');
    stale.state.version = 7;                                                                          // somebody saved in the meantime
    await p2.locator('[data-testid="selection-save"]').click();
    await p2.waitForSelector('[data-testid="selection-error"]');
    expect(await p2.locator('[data-testid="selection-error"]').innerText()).toContain('Someone else changed the selection rules');
    await p2.close();
  }, 120_000);

  function runServer(over: Record<string, unknown> = {}) {
    const items = (tie: boolean) => [
      { applicationId: 'a1', rank: 1, outcome: 'selected', explanation: 'Selected: 1st place.', tie: false, budgetSkipped: false, reference: 'REF-001', startupName: 'Alpha with_a_very_long_unbroken_name_that_cannot_wrap_anywhere_1234567890', amount: 150000 },
      { applicationId: 'a2', rank: 2, outcome: tie ? 'selected' : 'selected', explanation: tie ? 'Tie — decide: 2nd place, tied with 1 other on every criterion of the tie-break; Selected: 2nd place.' : 'Selected: 2nd place, Health quota.', tie, budgetSkipped: false, reference: 'REF-002', startupName: 'Beta', amount: 150000 },
      { applicationId: 'a3', rank: 3, outcome: 'waitlist', explanation: tie ? 'Tie — decide: 3rd place, tied with 1 other on every criterion of the tie-break; Waitlist: 3rd place, slots full.' : 'Waitlist: 3rd place, budget reached (needs 400000, 200000 left); a lower-ranked project that fits the budget was selected instead.', tie, budgetSkipped: !tie, reference: 'REF-003', startupName: 'Gamma', amount: null },
      { applicationId: 'a4', rank: 4, outcome: 'reject', explanation: 'Rejected: 4th place, not within the available places.', tie: false, budgetSkipped: false, reference: 'REF-004', startupName: 'Delta', amount: null },
      { applicationId: 'a5', rank: null, outcome: 'not_considered', explanation: 'Not considered: the evaluation is not complete.', tie: false, budgetSkipped: false, reference: 'REF-005', startupName: 'Epsilon', amount: null },
    ];
    const state = { tie: true, stale: false, applied: false, posts: [] as Record<string, unknown>[] };
    const view = () => ({ ok: true, canDecide: true, hasRules: true, rulesVersion: 1, locked: false, rulesStale: false, missingEvaluations: 1, warnings: [], manualOrder: [], ...over,
      run: { id: 'run-1', rulesVersion: 1, createdAt: '2026-11-03T10:00:00Z', appliedAt: state.applied ? '2026-11-03T11:00:00Z' : null, stale: state.stale, differing: state.applied ? 0 : 3, items: items(state.tie),
        summary: { selected: 2, waitlist: 1, rejected: 1, notConsidered: 1, budgetUsed: 300000, budgetLeft: 200000, places: 3, ties: state.tie ? ['a2', 'a3'] : [], skipped: state.tie ? [] : ['a3'], quotas: [{ quotaId: 'q1', label: 'Health', selected: 1, minSeats: 1, maxSeats: null, met: true }, { quotaId: 'q2', label: 'Energy', selected: 1, minSeats: 2, maxSeats: null, met: false }] } } });
    const handle: Handler = (method, _url, body) => {
      if (method === 'GET') return { status: 200, body: view() };
      state.posts.push(body ?? {});
      if (body?.action === 'ties') state.tie = false;
      if (body?.action === 'apply') { if (state.tie) return { status: 409, body: { ok: false, error: '2 applications are tied and someone must decide the order first (“Tie — decide”).' } }; state.applied = true; return { status: 200, body: { ...view(), applied: { written: 3, keptManual: 1, locked: 0, unchanged: 0 } } }; }
      return { status: 200, body: view() };
    };
    return { state, handle };
  }

  it('the board panel: the summary, the explanation of each application, the budget skip flagged, the quota not met; a tie blocks "Apply" until a person orders it; then it applies and says what it did', async () => {
    const srv = runServer();
    const { page, errors, overflow } = await open(1280, '__startSelPanel', srv.handle);
    await page.waitForSelector('[data-testid="selection-panel"]');
    expect(await page.locator('[data-testid="selection-line"]').innerText()).toContain('2 to advance · 1 on the waiting list · 1 to reject · not applied yet');
    await page.locator('[data-testid="selection-toggle"]').click();
    expect(await page.locator('[data-testid="selection-missing"]').innerText()).toBe('1 evaluation missing; the proposal may change.');
    expect((await page.locator('[data-testid="selection-summary"]').innerText()).replace(/\s+/g, ' ')).toContain('2 to advance (of 3 places) · 1 on the waiting list · 1 to reject · 1 not considered · budget used 300000, left 200000');
    expect(await page.locator('[data-testid="selection-quotas"]').innerText()).toContain('Energy: 1 (min 2) — not met');
    expect(await page.locator('[data-testid="selection-item"]').count()).toBe(5);
    expect(await page.locator('[data-testid="selection-ties"]').innerText()).toContain('Tie — decide');
    expect(await page.locator('[data-testid="selection-apply"]').isDisabled()).toBe(true);           // a tie nobody decided blocks it
    await page.locator('[data-testid="selection-ties"] li').first().getByRole('button', { name: 'Move down' }).click();
    await page.screenshot({ path: path.join(SHOTS, 'board-tie-1280.png'), fullPage: true });
    await page.locator('[data-testid="selection-ties-save"]').click();
    await page.waitForSelector('[data-testid="selection-said"]');
    expect(srv.state.posts[0]).toEqual({ action: 'ties', order: ['a3', 'a2'] });
    expect(await page.locator('[data-testid="selection-ties"]').count()).toBe(0);
    expect(await page.locator('[data-testid="selection-skipped"]').innerText()).toContain('1 project was skipped for the budget');
    expect(await page.locator('[data-testid="selection-differ"]').innerText()).toContain('3 decisions differ');
    expect(await page.locator('[data-testid="selection-apply"]').isDisabled()).toBe(false);
    await page.locator('[data-testid="selection-apply"]').click();
    await page.waitForFunction(() => /Applied:/.test(document.querySelector('[data-testid="selection-said"]')?.textContent ?? ''));
    expect(await page.locator('[data-testid="selection-said"]').innerText()).toBe('Applied: 3 decisions filled, 1 made by a person left as they were.');
    expect(await page.evaluate(() => (window as unknown as { __selChanged: number }).__selChanged)).toBeGreaterThanOrEqual(2);       // the board reloads its decisions
    await page.screenshot({ path: path.join(SHOTS, 'board-applied-1280.png'), fullPage: true });
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('out of date: it says why, "Apply" waits for a recalculation; no rules or a published call say so and offer nothing', async () => {
    const srv = runServer({ rulesStale: true }); srv.state.tie = false;
    const { page } = await open(1280, '__startSelPanel', srv.handle);
    await page.locator('[data-testid="selection-toggle"]').click();
    expect(await page.locator('[data-testid="selection-stale"]').innerText()).toContain('The proposal is out of date: the rules changed');
    expect(await page.locator('[data-testid="selection-apply"]').isDisabled()).toBe(true);
    expect(await page.locator('[data-testid="selection-propose"]').innerText()).toBe('Recalculate proposal');
    await page.close();
    const none = { ok: true, canDecide: true, hasRules: false, rulesVersion: 0, locked: false, run: null, missingEvaluations: 0, rulesStale: false, warnings: [] };
    const b = await open(1280, '__startSelPanel', () => ({ status: 200, body: none }));
    await b.page.locator('[data-testid="selection-toggle"]').click();
    expect(await b.page.locator('[data-testid="selection-norules"]').innerText()).toContain('Setup → Selection rules');
    expect(await b.page.locator('[data-testid="selection-propose"]').count()).toBe(0);
    await b.page.close();
    const fixed = runServer({ locked: true }); fixed.state.tie = false;
    const c = await open(1280, '__startSelPanel', fixed.handle);
    await c.page.locator('[data-testid="selection-toggle"]').click();
    expect(await c.page.locator('[data-testid="selection-fixed"]').innerText()).toContain('the selection is fixed');
    expect(await c.page.locator('[data-testid="selection-apply"]').count()).toBe(0);
    await c.page.close();
  }, 120_000);

  it('nothing is wider than the screen at 1280, 768 and 375 — long names, many quotas, the preview, the panel', async () => {
    for (const width of [1280, 768, 375]) {
      const full: SelectionRules = { ...DEFAULT_RULES, minTotal: 60, slots: 10, budget: { total: 1500000, per: 'asked', fixedAmount: null, fieldId: 'f-ask' }, minPerCriterion: [{ criterionId: 'team', min: 3 }],
        quotas: [{ id: 'q1', fieldId: 'f-sector', label: 'Health', match: { kind: 'option', optionId: 'health' }, minSeats: 2, maxSeats: 4 }, { id: 'q2', fieldId: 'f-ask', label: 'Small', match: { kind: 'range', min: 1000, max: 100000 }, minSeats: null, maxSeats: 3 }],
        tieBreak: [{ kind: 'criterion', criterionId: 'team' }, { kind: 'manual' }] };
      const a = await open(width, '__startSelStep', rulesServer(full).handle);
      await a.page.waitForSelector('[data-testid="selection-step"]');
      expect(await a.overflow(), `${width}px, step`).toBeLessThanOrEqual(0);
      const bad = await a.page.evaluate(() => { const root = document.querySelector('[data-testid="selection-step"]') as HTMLElement; const r = root.getBoundingClientRect(); const out: string[] = []; for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) { const b = el.getBoundingClientRect(); if (b.width && (b.right > r.right + 0.5 || b.left < r.left - 0.5)) out.push(`${el.tagName}.${String(el.className).slice(0, 30)}`); } return out; });
      expect(bad, `${width}px, step`).toEqual([]);
      if (width !== 1280) await a.page.screenshot({ path: path.join(SHOTS, `rules-${width}.png`), fullPage: true });
      await a.page.close();
      const srv = runServer();
      const p = await open(width, '__startSelPanel', srv.handle);
      await p.page.locator('[data-testid="selection-toggle"]').click();
      await p.page.waitForSelector('[data-testid="selection-items"]');
      expect(await p.overflow(), `${width}px, panel`).toBeLessThanOrEqual(0);
      if (width !== 1280) await p.page.screenshot({ path: path.join(SHOTS, `board-${width}.png`), fullPage: true });
      await p.page.close();
    }
  }, 240_000);
});
