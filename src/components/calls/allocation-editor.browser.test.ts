// Prompt 922 (Adenda 1, C) — "How the load is shared" in a REAL browser (the real DistributionPanel with its AllocationEditor, bundled with rolldown; the server is a small stand-in that applies the real parser, the real
// checks and the real allocation): Equal / Weighted / By rules; the percentages with their live sum and the maximums; panels and rules built on the screen (single choice, Yes/No, a range, several conditions), a panel
// smaller than N asking to be chosen about, what is incomplete said in words and keeping "Apply" off while the rules stay saved, the preview with what each evaluator and panel would get, the frozen rules asking in
// the page before a new version, and nothing wider than the screen at 375, 768 and 1280. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allocProblems, allocate, parseAlloc, type AllocConfig } from '@/lib/calls/eval-allocation';
import type { DistributionView } from '@/lib/calls/eval-assign-store';
import type { FormField } from '@/lib/calls/types';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://allocation.test';
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-922-adenda1');
const PEOPLE = [{ userId: 'u1', name: 'Rita Almeida', email: 'rita@fund.com' }, { userId: 'u2', name: 'Bruno Costa', email: 'bruno@fund.com' }, { userId: 'u3', name: 'Carla Dias', email: 'carla@fund.com' }, { userId: 'u4', name: 'Duarte Eira', email: 'duarte@fund.com' }];
const FIELDS = [
  { id: 'sector', number: 1, page: 1, label: 'Sector', kind: 'single_choice', options: [{ id: 'sector-health', label: 'Health' }, { id: 'sector-fintech', label: 'Fintech' }] },
  { id: 'grant', number: 2, page: 1, label: 'Have you received a grant?', kind: 'yes_no', options: [] },
  { id: 'raised', number: 3, page: 2, label: 'Investment received so far', kind: 'number', options: [] },
];
const APPS = Array.from({ length: 10 }, (_, i) => ({ applicationId: `a${String(i + 1).padStart(2, '0')}`, reference: `REF-${String(i + 1).padStart(3, '0')}`, answers: { sector: i % 2 === 0 ? 'sector-health' : 'sector-fintech', raised: String(i * 100000) } }));

describe.skipIf(!CHROME)('how the load is shared (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allocation-editor-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/distribution-panel.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `allocation-editor-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  function server(opts: { n?: number; submitted?: number } = {}) {
    const n = opts.n ?? 1;
    const state = { config: { strategy: 'equal', weighted: { by: 'percent', percent: {}, max: {} }, panels: [], rules: [], multi: 'first', fallback: 'equal' } as AllocConfig, rev: 0, version: 1, saves: [] as { config: AllocConfig; confirm: boolean }[] };
    const fields = FIELDS as unknown as Pick<FormField, 'id' | 'kind' | 'label' | 'options'>[];
    const problems = () => (state.config.strategy === 'equal' ? [] : allocProblems(state.config, { evaluators: PEOPLE.map((p) => ({ userId: p.userId, name: p.name })), fields, n }));
    const view = (): DistributionView => ({
      mode: 'auto', evaluatorsPerApplication: n, effectiveN: n, warning: null, unassigned: 0,
      evaluators: PEOPLE.map((p) => ({ ...p, assigned: 0, started: 0, submitted: 0 })), conflicts: [],
      applications: APPS.map((a) => ({ applicationId: a.applicationId, reference: a.reference, startupName: null, needed: n, short: true, byHand: false, evaluators: [] })),
      allocation: { config: state.config, version: state.version, rev: state.rev, mode: (opts.submitted ?? 0) > 0 ? 'versioned' : 'edit', evaluations: { started: opts.submitted ?? 0, submitted: opts.submitted ?? 0 }, problems: problems(), people: PEOPLE, fields: FIELDS },
    });
    return {
      state,
      handle: (method: string, body: Record<string, unknown> | null): { status: number; body: unknown } => {
        if (method === 'GET') return { status: 200, body: { ok: true, ...view() } };
        if (body?.action === 'allocation') {
          const p = parseAlloc(body.config);
          if (!p.ok) return { status: 400, body: { ok: false, error: p.error } };
          state.saves.push({ config: p.config, confirm: body.confirm === true });
          if ((opts.submitted ?? 0) > 0 && body.confirm !== true) return { status: 409, body: { ok: false, code: 'needs_confirm', error: `${opts.submitted} evaluation was already submitted. This change makes version 2 of the distribution rules; what was already evaluated stays as it is.` } };
          state.config = p.config; state.rev += 1; if ((opts.submitted ?? 0) > 0) { state.version += 1; state.rev = 0; }
          return { status: 200, body: { ok: true, ...view() } };
        }
        if (body?.action === 'preview') {
          const out = allocate({ config: state.config, applications: APPS.map((a) => ({ applicationId: a.applicationId, answers: a.answers })), fields, evaluators: PEOPLE.map((p) => p.userId), n, existing: [], blocked: [], replan: true });
          const name = (u: string) => PEOPLE.find((p) => p.userId === u)?.name ?? u;
          const probs = problems();
          return { status: 200, body: { ok: true, manual: false, warning: out.warning, loads: out.loads, newConflicts: 0, remove: [],
            add: out.add.map((a) => ({ applicationId: a.applicationId, reference: a.applicationId, userId: a.userId, evaluator: name(a.userId) })), keptWithConflict: [], shortfalls: [],
            allocation: state.config.strategy === 'equal' ? null : { strategy: state.config.strategy, blocked: probs.length > 0 || out.needsChoice.length > 0, problems: probs, needsChoice: out.needsChoice,
              evaluators: out.evaluators.map((e) => ({ ...e, name: name(e.userId) })), panels: out.panels.map((p) => ({ ...p, evaluators: p.evaluators.map((e) => ({ ...e, name: name(e.userId) })) })), unassigned: out.unassigned.map((id) => ({ applicationId: id, reference: id })) } } };
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
    await page.waitForSelector('[data-testid="allocation"]');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const saved = () => page.waitForFunction(() => document.querySelectorAll('[data-testid="alloc-dirty"]').length === 0);
    return { page, errors, dialogs, overflow, saved };
  }

  it('Weighted: a percentage each with its live sum (⚠ until 100 %); the preview says what each would get; with 90 % nothing can be applied, and the rules stay saved', async () => {
    const srv = server();
    const { page, errors, dialogs, overflow, saved } = await open(1280, srv);
    expect(await page.locator('[data-testid="alloc-equal"]').isChecked()).toBe(true);
    await page.locator('[data-testid="alloc-weighted"]').click();
    expect(await page.locator('[data-testid="alloc-sum"]').innerText()).toContain('⚠ Sum of the percentages: 0 % — 100 % missing');
    await page.locator('[data-testid="alloc-pct-u1"]').fill('30'); await page.locator('[data-testid="alloc-pct-u2"]').fill('50'); await page.locator('[data-testid="alloc-pct-u3"]').fill('10');
    expect(await page.locator('[data-testid="alloc-sum"]').innerText()).toContain('⚠ Sum of the percentages: 90 % — 10 % missing');
    expect(await page.locator('[data-testid="alloc-problems"]').innerText()).toContain('the percentages add up to 90 %');
    await page.locator('[data-testid="alloc-save"]').click(); await saved();
    expect(srv.state.config.weighted.percent).toMatchObject({ u1: 30, u2: 50, u3: 10 });
    await page.locator('[data-testid="redistribute"]').click();
    await page.waitForSelector('[data-testid="preview-problems"]');
    expect(await page.locator('[data-testid="preview-problems"]').innerText()).toContain('the percentages add up to 90 %');
    expect(await page.locator('[data-testid="preview-apply"]').isDisabled()).toBe(true);                          // nothing can be applied while it is incomplete
    await page.close();
    // 100 %: the preview shows what each would really get
    const ok = server();
    const o = await open(1280, ok);
    await o.page.locator('[data-testid="alloc-weighted"]').click();
    for (const [u, v] of [['u1', '30'], ['u2', '50'], ['u3', '20'], ['u4', '0']]) await o.page.locator(`[data-testid="alloc-pct-${u}"]`).fill(v);
    expect(await o.page.locator('[data-testid="alloc-sum"]').innerText()).toBe('Sum of the percentages: 100 % ✓');
    expect(await o.page.locator('[data-testid="alloc-problems"]').count()).toBe(0);
    await o.page.locator('[data-testid="alloc-save"]').click(); await o.saved();
    await o.page.locator('[data-testid="redistribute"]').click();
    await o.page.waitForSelector('[data-testid="preview-evaluators"]');
    expect(await o.page.locator('[data-testid="preview-evaluator"]').allInnerTexts()).toEqual(['Rita Almeida\nasked 30 % · would have 3', 'Bruno Costa\nasked 50 % · would have 5', 'Carla Dias\nasked 20 % · would have 2', 'Duarte Eira\nasked 0 % · would have 0'].map((t) => expect.stringContaining(t.split('\n')[1])));
    expect(await o.page.locator('[data-testid="preview-apply"]').isDisabled()).toBe(false);
    await o.page.screenshot({ path: path.join(SHOTS, 'distribution-weighted-1280.png'), fullPage: true });
    expect(await o.overflow()).toBeLessThanOrEqual(0);
    expect([...errors, ...o.errors]).toEqual([]); expect(dialogs).toEqual([]);
    await o.page.close();
  }, 120_000);

  it('Weighted, by a maximum: the inputs change to a number of applications each', async () => {
    const srv = server();
    const { page, saved } = await open(1280, srv);
    await page.locator('[data-testid="alloc-weighted"]').click();
    await page.locator('[data-testid="alloc-by-max"]').click();
    expect(await page.locator('[data-testid="alloc-pct-u1"]').count()).toBe(0);
    expect(await page.locator('[data-testid="alloc-sum"]').count()).toBe(0);
    expect(await page.locator('[data-testid="alloc-problems"]').innerText()).toContain('give Rita Almeida a maximum number of applications');
    for (const [u, v] of [['u1', '2'], ['u2', '3'], ['u3', '10'], ['u4', '1']]) await page.locator(`[data-testid="alloc-max-${u}"]`).fill(v);
    expect(await page.locator('[data-testid="alloc-problems"]').count()).toBe(0);
    await page.locator('[data-testid="alloc-save"]').click(); await saved();
    expect(srv.state.config.weighted).toMatchObject({ by: 'max', max: { u1: 2, u2: 3, u3: 10, u4: 1 } });
    await page.close();
  }, 120_000);

  it('By rules: two panels, rules over a single choice and over a range with a second condition, the fallback, "all matching panels" — built on the screen and saved as built', async () => {
    const srv = server();
    const { page, errors, overflow, saved } = await open(1280, srv);
    await page.locator('input[name="alloc-strategy"]').nth(2).click();
    await page.waitForSelector('[data-testid="alloc-rules"]');
    expect(await page.locator('[data-testid="alloc-problems"]').innerText()).toContain('Create at least one panel of evaluators.');
    for (const [i, name] of ['Health panel', 'Seed panel'].entries()) {
      await page.locator('[data-testid="alloc-add-panel"]').click();
      await page.locator('[data-testid="alloc-panel-name"]').nth(i).fill(name);
    }
    const panels = page.locator('[data-testid="alloc-panel"]');
    await panels.nth(0).locator('input[type="checkbox"]').nth(0).check(); await panels.nth(0).locator('input[type="checkbox"]').nth(1).check();
    await panels.nth(1).locator('input[type="checkbox"]').nth(2).check(); await panels.nth(1).locator('input[type="checkbox"]').nth(3).check();
    // rule 1: Sector is Health → Health panel
    await page.locator('[data-testid="alloc-add-rule"]').click();
    const r1 = page.locator('[data-testid="alloc-rule"]').nth(0);
    await r1.locator('[data-testid="alloc-option-sector-health"]').check();
    await r1.locator('[data-testid="alloc-rule-panel"]').selectOption({ label: 'Health panel' });
    // rule 2: investment received up to 250 000 AND Yes to the grant → Seed panel
    await page.locator('[data-testid="alloc-add-rule"]').click();
    const r2 = page.locator('[data-testid="alloc-rule"]').nth(1);
    await r2.locator('[data-testid="alloc-condition-field"]').selectOption('raised');
    await r2.locator('[data-testid="alloc-range-min"]').fill('0'); await r2.locator('[data-testid="alloc-range-max"]').fill('250000');
    await r2.locator('[data-testid="alloc-add-condition"]').click();
    await r2.locator('[data-testid="alloc-condition-field"]').nth(1).selectOption('grant');
    await r2.locator('[data-testid="alloc-rule-panel"]').selectOption({ label: 'Seed panel' });
    await page.locator('[data-testid="alloc-multi-all"]').click();
    await page.locator('[data-testid="alloc-fallback-unassigned"]').click();
    expect(await page.locator('[data-testid="alloc-problems"]').count()).toBe(0);
    await page.locator('[data-testid="alloc-save"]').click(); await saved();
    const cfg = srv.state.config;
    expect(cfg).toMatchObject({ strategy: 'rules', multi: 'all', fallback: 'unassigned' });
    expect(cfg.panels.map((p) => [p.name, p.members])).toEqual([['Health panel', ['u1', 'u2']], ['Seed panel', ['u3', 'u4']]]);
    expect(cfg.rules[0].conditions).toEqual([{ fieldId: 'sector', type: 'choice', optionIds: ['sector-health'] }]);
    expect(cfg.rules[1].conditions).toEqual([{ fieldId: 'raised', type: 'range', min: 0, max: 250000 }, { fieldId: 'grant', type: 'yes_no', yes: true }]);
    expect(cfg.rules.map((r) => r.panelId)).toEqual([cfg.panels[0].id, cfg.panels[1].id]);
    // the preview: per panel, who gets what, and what is left unassigned
    await page.locator('[data-testid="redistribute"]').click();
    await page.waitForSelector('[data-testid="preview-panel"]');
    const texts = await page.locator('[data-testid="preview-panel"]').allInnerTexts();
    expect(texts[0]).toContain('Health panel · 5 applications');
    expect(await page.locator('[data-testid="preview-allocation"]').innerText()).toContain('Unassigned');
    await page.screenshot({ path: path.join(SHOTS, 'distribution-rules-1280.png'), fullPage: true });
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);

  it('a panel smaller than the number of evaluators asks to be chosen about, and the preview cannot be applied until it is; a rule needs a panel and a condition — said in words', async () => {
    const srv = server({ n: 3 });
    const { page, saved } = await open(1280, srv);
    await page.locator('input[name="alloc-strategy"]').nth(2).click();
    await page.locator('[data-testid="alloc-add-panel"]').click();
    await page.locator('[data-testid="alloc-panel-name"]').fill('Health panel');
    await page.locator('[data-testid="alloc-panel"] input[type="checkbox"]').nth(0).check(); await page.locator('[data-testid="alloc-panel"] input[type="checkbox"]').nth(1).check();
    expect(await page.locator('[data-testid="alloc-panel-short"]').innerText()).toContain('This panel has 2 evaluators but each application needs 3');
    await page.locator('[data-testid="alloc-add-rule"]').click();
    await page.locator('[data-testid="alloc-option-sector-health"]').check();
    await page.locator('[data-testid="alloc-rule-panel"]').selectOption({ label: 'Health panel' });
    expect(await page.locator('[data-testid="alloc-problems"]').innerText()).toContain('choose to complete with other evaluators or to lower the number for this panel');
    await page.locator('[data-testid="alloc-save"]').click(); await saved();
    await page.locator('[data-testid="redistribute"]').click();
    await page.waitForSelector('[data-testid="preview-problems"]');
    expect(await page.locator('[data-testid="preview-apply"]').isDisabled()).toBe(true);
    await page.locator('[data-testid="preview-cancel"]').click();
    await page.locator('select[data-testid^="alloc-shortfall-"]').selectOption('lower');
    expect(await page.locator('[data-testid="alloc-problems"]').count()).toBe(0);
    await page.locator('[data-testid="alloc-save"]').click(); await saved();
    await page.locator('[data-testid="redistribute"]').click();
    await page.waitForSelector('[data-testid="preview-allocation"]');
    expect(await page.locator('[data-testid="preview-apply"]').isDisabled()).toBe(false);
    await page.close();
  }, 180_000);

  it('once an evaluation is submitted the rules are frozen: a change asks IN the page before it makes a new version', async () => {
    const srv = server({ submitted: 1 });
    const { page, dialogs, saved } = await open(1280, srv);
    expect(await page.locator('[data-testid="alloc-frozen"]').innerText()).toContain('1 evaluation already submitted: these rules are frozen (version 1)');
    await page.locator('[data-testid="alloc-weighted"]').click();
    await page.locator('[data-testid="alloc-pct-u1"]').fill('100');
    await page.locator('[data-testid="alloc-save"]').click();
    await page.waitForSelector('[data-testid="alloc-confirm"]');
    expect(await page.locator('[data-testid="alloc-confirm"]').innerText()).toContain('makes version 2');
    expect(srv.state.config.strategy).toBe('equal');                                  // nothing changed yet
    await page.locator('[data-testid="alloc-confirm-yes"]').click(); await saved();
    expect(srv.state.saves.map((s) => s.confirm)).toEqual([false, true]);
    expect(srv.state.config.strategy).toBe('weighted');
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('375 and 768 px: nothing wider than the screen with a panel, a rule and the percentages open (screenshot kept)', async () => {
    for (const w of [375, 768]) {
      const srv = server();
      const { page, overflow } = await open(w, srv);
      await page.locator('input[name="alloc-strategy"]').nth(2).click();
      await page.locator('[data-testid="alloc-add-panel"]').click();
      await page.locator('[data-testid="alloc-panel-name"]').fill('A panel with_a_very_long_unbroken_name_that_cannot_wrap_anywhere_1234567890');
      await page.locator('[data-testid="alloc-add-rule"]').click();
      await page.locator('[data-testid="alloc-fallback-weighted"]').click();
      expect(await overflow()).toBeLessThanOrEqual(0);
      if (w === 375) await page.screenshot({ path: path.join(SHOTS, 'distribution-rules-375.png'), fullPage: true });
      await page.close();
    }
  }, 120_000);
});
