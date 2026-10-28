// Prompt 918 (I2) — the Eligibility step in a REAL browser (the real EligibilityStep bundled with rolldown; its API answered by a small in-memory server built on the real parser and view builder): add a
// rule and see its sentence while writing it, save, edit, remove (asked in the page), use and discard a suggestion, the frozen state asking for a confirmation that names how many applications are
// evaluated again, and no sideways scroll at 1280/768/375 px. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newField } from '@/lib/calls/form-builder';
import { parseRulesPayload, type EligibilityRule } from '@/lib/calls/eligibility';
import { buildEligibilityView } from '@/lib/calls/eligibility-view';
import { prepareRecipe } from '@/lib/calls/doc-recipe';
import type { Call, FormField } from '@/lib/calls/types';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://eligibility.test';

const Q = { sector: '10000000-0000-4000-8000-000000000001', raised: '10000000-0000-4000-8000-000000000002', cert: '10000000-0000-4000-8000-000000000005', name: '10000000-0000-4000-8000-000000000006' };
const fields = (): FormField[] => [
  { ...newField('single_choice', 1, 0), id: Q.sector, label: 'Which sector does your startup work in, taking into account everything in the regulation of the call?', options: [{ id: 'o-health', label: 'Health' }, { id: 'o-energy', label: 'Energy' }, { id: 'o-other', label: 'Other' }] },
  { ...newField('number', 1, 1), id: Q.raised, label: 'Amount you are raising' },
  { ...newField('file', 2, 0), id: Q.cert, label: 'Permanent Certificate', instruction: 'Issued less than 3 months ago.' },
  { ...newField('short_text', 1, 3), id: Q.name, label: 'Company name' },
];
const call = (over: Partial<Call> = {}): Call => ({ id: 'c1', status: 'draft', currency: 'EUR', opensAt: '2026-10-01T09:00:00.000Z', closesAt: '2026-12-01T09:00:00.000Z', timezone: 'Europe/Lisbon', eligibilityVersion: 1, eligibilityRev: 0, ...over } as Call);

describe.skipIf(!CHROME)('the eligibility step (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eligibility-step-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/eligibility-step.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `eligibility-step-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  /** A small in-memory stand-in for the routes, built on the real parser and view builder. */
  function server(opts: { status?: Call['status']; suggestions?: string[]; submitted?: number } = {}) {
    const state = { rules: [] as EligibilityRule[], rev: 0, version: 1, suggestions: [...(opts.suggestions ?? [])], status: opts.status ?? 'draft' as Call['status'], puts: [] as unknown[] };
    const view = () => buildEligibilityView({
      call: call({ status: state.status, eligibilityRev: state.rev, eligibilityVersion: state.version }), fields: fields(), rules: state.rules,
      recipes: state.rules.filter((r) => r.kind.startsWith('doc_')).map((r) => ({ ruleId: r.id, recipe: prepareRecipe(r, fields().find((f) => f.id === r.fieldId)!, fields()).recipe })), suggestions: state.suggestions, submitted: opts.submitted ?? 0,
    });
    return {
      state,
      handle: (method: string, url: string, body: Record<string, unknown> | null): { status: number; body: unknown } => {
        if (url.endsWith('/suggestion') && method === 'POST') { state.suggestions = state.suggestions.filter((t) => t !== body?.text); return { status: 200, body: { ok: true } }; }
        if (method === 'GET') return { status: 200, body: { ok: true, canManage: true, ...view() } };
        state.puts.push(body);
        const parsed = parseRulesPayload(body?.rules, fields());
        if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
        if (state.status === 'open' && body?.confirm !== true) return { status: 409, body: { ok: false, code: 'needs_confirm', submitted: opts.submitted ?? 0, nextVersion: state.version + 1, error: `The rules are frozen because the call has opened. This change makes version ${state.version + 1} and evaluates the ${opts.submitted ?? 0} submitted applications again against it. Continue?` } };
        if (state.status === 'open') state.version += 1;
        state.rules = parsed.rules; state.rev += 1;
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
      const r = srv.handle(route.request().method(), url.pathname, raw ? JSON.parse(raw) : null);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as { __startEligibility: () => void }).__startEligibility());
    await page.waitForSelector('[data-testid="eligibility-step"]');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, overflow };
  }

  it('add a rule: the sentence is shown while writing it; saved, it appears with its boundary; edit it; remove it (asked in the page)', async () => {
    const srv = server();
    const { page, errors, dialogs, overflow } = await open(1280, srv);
    expect(await page.locator('[data-testid="no-rules"]').count()).toBe(1);
    await page.locator('[data-testid="add-rule"]').click();
    await page.locator('[data-testid="rule-question"]').selectOption(Q.raised);
    expect(await page.locator('[data-testid="rule-kind"] option').allInnerTexts()).toEqual(['Choose…', 'Number', 'Open answer']);
    await page.locator('[data-testid="rule-kind"]').selectOption('number');
    await page.locator('#rule-value').fill('500000');
    const preview = (await page.locator('[data-testid="rule-preview"]').innerText()).replace(/\s/g, ' ');
    expect(preview).toContain('500 000 € or less');
    expect(preview).toContain('exactly 500 000 € is eligible');
    await page.locator('[data-testid="rule-save"]').click();
    await page.waitForSelector('[data-testid="rule-card"]');
    expect((await page.locator('[data-testid="rule-sentence"]').innerText()).replace(/\s/g, ' ')).toContain('Applicants who state 500 000 € or less in “Amount you are raising” are eligible');
    expect(await page.evaluate(() => (window as unknown as { __count: number }).__count)).toBe(1);
    // edit: exactly
    await page.locator('[data-testid="rule-edit"]').click();
    await page.locator('#rule-op').selectOption('eq');
    await page.locator('[data-testid="rule-save"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="rule-sentence"]')?.textContent?.includes('exactly'));
    // remove: asked in the page, "Keep" keeps, "Yes" removes
    await page.locator('[data-testid="rule-remove"]').click();
    await page.locator('[data-testid="rule-remove-no"]').click();
    expect(await page.locator('[data-testid="rule-card"]').count()).toBe(1);
    await page.locator('[data-testid="rule-remove"]').click();
    await page.locator('[data-testid="rule-remove-yes"]').click();
    await page.waitForSelector('[data-testid="no-rules"]');
    expect(srv.state.rules).toHaveLength(0);
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('a document rule shows "How we check this document", read only, prepared from the entity\'s text', async () => {
    const srv = server();
    const { page } = await open(1280, srv);
    await page.locator('[data-testid="add-rule"]').click();
    await page.locator('[data-testid="rule-question"]').selectOption(Q.cert);
    await page.locator('[data-testid="rule-kind"]').selectOption('doc_valid');
    await page.locator('#rule-name').selectOption(Q.name);
    await page.locator('[data-testid="rule-save"]').click();
    await page.waitForSelector('[data-testid="rule-recipe"]');
    await page.locator('[data-testid="rule-recipe"] summary').click();
    const text = await page.locator('[data-testid="rule-recipe"]').innerText();
    expect(text).toContain('We look for: Permanent Certificate');
    expect(text).toContain('within the last 3 months');
    expect(text).toContain('Nobody has to confirm it');
    expect(await page.locator('[data-testid="rule-recipe"] input, [data-testid="rule-recipe"] textarea, [data-testid="rule-recipe"] button').count()).toBe(0);
    await page.close();
  }, 120_000);

  it('suggestions from the import: "Create a rule from this" opens the form with the text; "Discard" removes it for good', async () => {
    const srv = server({ suggestions: ['Startups founded less than 5 years ago', 'Head office in Portugal'] });
    const { page } = await open(1280, srv);
    expect(await page.locator('[data-testid="suggestion"]').count()).toBe(2);
    await page.locator('[data-testid="suggestion"]').nth(1).locator('[data-testid="suggestion-dismiss"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="suggestion"]').length === 1);
    await page.locator('[data-testid="suggestion-use"]').click();
    expect(await page.locator('[data-testid="rule-form"]').innerText()).toContain('From your documents: “Startups founded less than 5 years ago”');
    expect(srv.state.rules).toHaveLength(0);                                                               // nothing became a rule without being saved
    await page.close();
  }, 120_000);

  it('once the call has opened the rules are frozen: a change asks, in the page, naming the applications evaluated again, then makes a new version', async () => {
    const srv = server({ status: 'open', submitted: 7 });
    const { page, dialogs } = await open(1280, srv);
    expect(await page.locator('[data-testid="eligibility-frozen"]').innerText()).toContain('evaluates the 7 submitted applications again');
    await page.locator('[data-testid="add-rule"]').click();
    await page.locator('[data-testid="rule-question"]').selectOption(Q.raised);
    await page.locator('[data-testid="rule-kind"]').selectOption('number');
    await page.locator('#rule-value').fill('10');
    await page.locator('[data-testid="rule-save"]').click();
    expect(await page.locator('[data-testid="eligibility-confirm"]').innerText()).toContain('version 2');
    expect(srv.state.rules).toHaveLength(0);
    await page.locator('[data-testid="eligibility-confirm-yes"]').click();
    await page.waitForSelector('[data-testid="rule-card"]');
    expect(srv.state.version).toBe(2);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('nothing is wider than the screen at 1280, 768 and 375 — the form with every kind of parameter and long labels', async () => {
    for (const width of [1280, 768, 375]) {
      const srv = server({ suggestions: ['A very long requirement that goes on and on, with a_very_long_unbroken_word_that_cannot_wrap_anywhere_by_itself_1234567890 and then some more words after it'] });
      const { page, overflow } = await open(width, srv);
      await page.locator('[data-testid="add-rule"]').click();
      await page.locator('[data-testid="rule-question"]').selectOption(Q.sector);
      await page.locator('[data-testid="rule-kind"]').selectOption('options');
      await page.locator('[data-testid="params-options"] input[type="checkbox"]').first().check();
      expect(await overflow(), `${width}px, options`).toBeLessThanOrEqual(0);
      const boxes = await page.evaluate(() => {
        const form = document.querySelector('[data-testid="rule-form"]') as HTMLElement; const r = form.getBoundingClientRect(); const bad: string[] = [];
        for (const el of Array.from(form.querySelectorAll<HTMLElement>('*'))) { const b = el.getBoundingClientRect(); if (b.width === 0) continue; if (b.right > r.right + 0.5 || b.left < r.left - 0.5) bad.push(`${el.tagName}.${String(el.className).slice(0, 30)}`); if (el.scrollWidth > el.clientWidth + 0.5 && getComputedStyle(el).display !== 'inline') bad.push(`scroll ${el.tagName}`); }
        return bad;
      });
      expect(boxes, `${width}px`).toEqual([]);
      await page.locator('[data-testid="rule-question"]').selectOption(Q.raised);
      await page.locator('[data-testid="rule-kind"]').selectOption('number');
      await page.locator('#rule-op').selectOption('between');
      expect(await overflow(), `${width}px, number`).toBeLessThanOrEqual(0);
      await page.close();
    }
  }, 180_000);
});
