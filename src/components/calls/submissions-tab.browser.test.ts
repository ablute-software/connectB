// Prompt 930 (B) — the Applications screen in a REAL browser (the real SubmissionsTab with the real ApplicationEligibility; the server is a small stand-in): the filters with their counts ("All (24) · Fit (15) ·
// Not a fit (6) · To validate (3) · Changed by a person") and the filter in the ADDRESS (shareable, kept on reload); the two ways to reclassify, in view without scrolling at 1280 and at 375, with the reason asked in
// the page; the rules split in Unmet / To validate / Met, opening on the one that explains the result, with the sentence, the reason, the evidence and "Open document"; and the documents opening INSIDE the platform
// (the data room's viewer, the platform's own route, never a Storage address; a format it cannot show offers "Download"). Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EligibilityInfo, EligibilityState, EligibilityView } from '@/lib/calls/eligibility-payload';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://applications.test';
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-930');
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

type Row = { applicationId: string; reference: string; startup: string; submittedAt: string; eligibility: { state: EligibilityState; view: EligibilityView; reason: string; source: string | null }; duplicates: number };
const rows: Row[] = [];
const add = (n: number, state: 'fit' | 'not_fit' | 'to_validate', source: string | null = 'engine') => {
  for (let i = 0; i < n; i++) { const id = `a${rows.length + 1}`; rows.push({ applicationId: id, reference: `REF-${String(rows.length + 1).padStart(3, '0')}`, startup: `Startup ${rows.length + 1}`, submittedAt: '2026-10-20T10:00:00Z', eligibility: { state, view: state, reason: 'x', source: i === 0 ? source : 'engine' }, duplicates: 0 }); }
};
add(15, 'fit'); add(6, 'not_fit', 'human'); add(3, 'to_validate', 'flag');                   // the first of "Not a fit" was corrected by a person, the first of "To validate" was flagged by one
rows[0].eligibility.source = 'human';                                                      // …and one Fit was reclassified by a person too

const FIELDS = [
  { id: 'f-name', kind: 'short_text', label: 'Startup name', page: 1, position: 0, options: [], validations: {}, required: false, instruction: null, condition: null },
  { id: 'f-funding', kind: 'yes_no', label: 'Did you receive previous funding?', page: 1, position: 1, options: [], validations: {}, required: false, instruction: null, condition: null },
  { id: 'f-deck', kind: 'file', label: 'Pitch deck', page: 2, position: 0, options: [], validations: {}, required: false, instruction: null, condition: null },
  { id: 'f-model', kind: 'file', label: 'Financial model', page: 2, position: 1, options: [], validations: {}, required: false, instruction: null, condition: null },
];
const DOCS = [
  { fileId: 'file-deck', fieldId: 'f-deck', fileName: 'pitch-deck.pdf', size: 2048, source: 'upload', versionNumber: null },
  { fileId: 'file-model', fieldId: 'f-model', fileName: 'model.xlsx', size: 4096, source: 'upload', versionNumber: null },
];
const rule = (id: string, effective: 'pass' | 'fail' | 'validate', over: Record<string, unknown> = {}) => ({
  ruleId: id, kind: 'options', sentence: `Rule ${id}: the answer must be Yes.`, engine: effective, effective, reason: `The reason of rule ${id}.`, evidence: null, override: null, fieldId: 'f-funding', ...over,
});
const info = (state: EligibilityState, rules: unknown[]): EligibilityInfo => ({ state, reason: 'The result in words.', source: 'engine', rulesVersion: 1, rules: rules as never, reclassified: null, error: null });

describe.skipIf(!CHROME)('the Applications screen: eligibility (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'submissions-tab-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/submissions-tab.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `submissions-tab-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(width: number, search = '') {
    const page = await browser.newPage({ viewport: { width, height: width < 700 ? 800 : 900 } });
    const errors: string[] = []; const dialogs: string[] = []; const posted: Record<string, unknown>[] = []; const gets: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      const m = route.request().method();
      if (url.pathname === '/calls') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` });
      gets.push(`${m} ${url.pathname}`);
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/calls/c1/submissions' && m === 'GET') return json({ ok: true, submissions: rows, counts: {} });
      const doc = /^\/api\/calls\/c1\/submissions\/(a\d+)\/documents\/([\w-]+)$/.exec(url.pathname);
      if (doc) {
        const isPdf = doc[2] === 'file-deck';
        return route.fulfill({ status: 200, headers: { 'content-type': isPdf ? 'application/pdf' : 'application/octet-stream', 'content-disposition': isPdf ? "inline; filename*=UTF-8''pitch-deck.pdf" : "attachment; filename*=UTF-8''model.xlsx" }, body: isPdf ? PDF_BYTES : Buffer.from('xlsx') });
      }
      const elig = /^\/api\/calls\/c1\/submissions\/(a\d+)\/eligibility$/.exec(url.pathname);
      if (elig && m === 'POST') { posted.push(JSON.parse(route.request().postData() ?? '{}')); return json({ ok: true }); }
      const det = /^\/api\/calls\/c1\/submissions\/(a\d+)$/.exec(url.pathname);
      if (det && m === 'GET') {
        const r = rows.find((x) => x.applicationId === det[1])!;
        const rules = r.eligibility.state === 'not_fit'
          ? [rule('r1', 'fail', { reason: '“Did you receive previous funding?”: the answer is “No”, not “Yes”.' }), rule('r2', 'fail', { kind: 'doc_date', fieldId: 'f-deck', evidence: { fileName: 'pitch-deck.pdf', page: 1, quote: 'Issued on 2026-01-12' } }), rule('r3', 'pass', { fieldId: 'f-name' })]
          : r.eligibility.state === 'to_validate' ? [rule('r1', 'validate', { kind: 'open' }), rule('r3', 'pass', { fieldId: 'f-name' })] : [rule('r1', 'pass'), rule('r3', 'pass', { fieldId: 'f-name' })];
        return json({
          ok: true, applicationId: r.applicationId, reference: r.reference, startup: r.startup, submittedAt: r.submittedAt, version: 1, fields: FIELDS,
          answers: { 'f-name': r.startup, 'f-funding': 'no', 'f-deck': [{ fileId: 'file-deck', fileName: 'pitch-deck.pdf', size: 2048 }], 'f-model': [{ fileId: 'file-model', fileName: 'model.xlsx', size: 4096 }] },
          documents: DOCS.map((d) => ({ ...d, url: `/api/calls/c1/submissions/${r.applicationId}/documents/${d.fileId}` })), eligibility: info(r.eligibility.state, rules), duplicates: [], canCorrect: true, canFlag: true,
        });
      }
      return json({ ok: false }, 404);
    });
    await page.goto(`${ORIGIN}/calls${search}`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as { __startSubmissions: () => void }).__startSubmissions());
    await page.waitForSelector('[data-testid="submissions-tab"]');
    await page.waitForSelector('[data-testid="eligibility-views"]');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, posted, gets, overflow };
  }
  const visibleRows = (page: import('playwright').Page) => page.locator('[data-testid="submission-row"], [data-testid="submission-card"]:visible').count();
  const openFirst = async (page: import('playwright').Page) => { await page.locator('[data-testid="submission-row"] button, [data-testid="submission-card"] button').filter({ visible: true }).first().click(); await page.waitForSelector('[data-testid="eligibility-panel"]'); };

  it('the filters show their counts and the filter is in the address: it can be shared, and it survives a reload', async () => {
    const { page, errors } = await open(1280);
    const labels = await page.locator('[data-testid="eligibility-views"] button').allInnerTexts();
    expect(labels).toEqual(['All (24)', 'Fit (15)', 'Not a fit (6)', 'To validate (3)', 'Changed by a person (3)']);
    expect(await visibleRows(page)).toBe(24);
    await page.locator('[data-testid="view-not_fit"]').click();
    expect(await visibleRows(page)).toBe(6);
    expect(new URL(page.url()).searchParams.get('elig')).toBe('not_fit');
    expect(await page.locator('[data-testid="view-not_fit"]').getAttribute('aria-pressed')).toBe('true');
    await page.locator('[data-testid="view-changed"]').click();
    expect(await visibleRows(page)).toBe(3);
    expect(new URL(page.url()).searchParams.get('elig')).toBe('changed');
    await page.locator('[data-testid="view-all"]').click();
    expect(new URL(page.url()).searchParams.has('elig')).toBe(false);
    await page.close();
    // the address opens straight on the filter (a shared link, a reload)
    const again = await open(1280, '?section=applications&elig=to_validate');
    expect(await again.page.locator('[data-testid="view-to_validate"]').getAttribute('aria-pressed')).toBe('true');
    expect(await visibleRows(again.page)).toBe(3);
    expect(new URL(again.page.url()).searchParams.get('section')).toBe('applications');                   // what else the address says is kept
    expect(errors).toEqual([]); expect(again.errors).toEqual([]);
    await again.page.screenshot({ path: path.join(SHOTS, 'list-filters-1280.png'), fullPage: true });
    await again.page.close();
  }, 120_000);

  it('the rules of an application are Unmet / To validate / Met, and it opens on the one that explains the result: Unmet for a Not a fit, To validate for a To validate, Met for a Fit', async () => {
    const a = await open(1280, '?elig=not_fit');
    await openFirst(a.page);
    expect(await a.page.locator('[data-testid="rule-tabs"] button').allInnerTexts()).toEqual(['Unmet (2)', 'To validate (0)', 'Met (1)']);
    expect(await a.page.locator('[data-testid="rules-unmet"]').getAttribute('aria-selected')).toBe('true');
    expect(await a.page.locator('[data-testid="eligibility-rule"]').count()).toBe(2);
    // each rule: the sentence, the reason, the evidence (the answer, or the quote and the page), "Open document"
    const first = a.page.locator('[data-testid="eligibility-rule"]').nth(0);
    expect(await first.locator('[data-testid="rule-sentence"]').innerText()).toBe('Rule r1: the answer must be Yes.');
    expect(await first.locator('[data-testid="rule-reason"]').innerText()).toContain('the answer is “No”');
    expect(await first.locator('[data-testid="rule-evidence"]').innerText()).toBe('Answer: No');
    const second = a.page.locator('[data-testid="eligibility-rule"]').nth(1);
    expect(await second.locator('[data-testid="rule-evidence"]').innerText()).toContain('pitch-deck.pdf · page 1 — “Issued on 2026-01-12”');
    expect(await second.locator('[data-testid="open-document"]').innerText()).toBe('Open document');
    await a.page.locator('[data-testid="rules-met"]').click();
    expect(await a.page.locator('[data-testid="eligibility-rule"]').count()).toBe(1);
    await a.page.locator('[data-testid="rules-validate"]').click();
    expect(await a.page.locator('[data-testid="rules-empty"]').innerText()).toBe('No rule in this list.');
    await a.page.close();
    const v = await open(1280, '?elig=to_validate');
    await openFirst(v.page);
    expect(await v.page.locator('[data-testid="rules-validate"]').getAttribute('aria-selected')).toBe('true');
    await v.page.close();
    const f = await open(1280, '?elig=fit');
    await openFirst(f.page);
    expect(await f.page.locator('[data-testid="rules-met"]').getAttribute('aria-selected')).toBe('true');
    await f.page.close();
  }, 180_000);

  it('"Mark as Fit" and "Mark as Not a fit" are at the top of the application, in view without scrolling (1280 and 375); the current result is marked and off; the reason is asked in the page; "Flag" is the quiet action beside', async () => {
    for (const width of [1280, 375]) {
      const { page, posted, dialogs, overflow } = await open(width, '?elig=not_fit');
      await openFirst(page);
      const inView = await page.evaluate(() => {
        const b = ['reclassify-fit', 'reclassify-notfit', 'flag'].map((id) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect());
        return { scrollY: window.scrollY, all: b.every((r) => r.top >= 0 && r.bottom <= window.innerHeight) };
      });
      expect(inView, `${width}px`).toEqual({ scrollY: 0, all: true });
      expect(await page.locator('[data-testid="reclassify-notfit"]').isDisabled()).toBe(true);                 // the current result: marked and off
      expect(await page.locator('[data-testid="reclassify-notfit"]').innerText()).toBe('✓ Not a fit (current)');
      expect(await page.locator('[data-testid="reclassify-fit"]').innerText()).toBe('Mark as Fit');
      expect(await page.locator('[data-testid="flag"]').innerText()).toBe('Flag possible ineligibility');
      await page.locator('[data-testid="reclassify-fit"]').click();
      expect(await page.locator('[data-testid="eligibility-form"]').innerText()).toContain('Reclassify this application as Fit');
      await page.locator('[data-testid="eligibility-confirm"]').click();
      expect(await page.locator('[data-testid="eligibility-error"]').innerText()).toBe('Say why: a correction always has a reason.');
      expect(posted).toEqual([]);                                                                                // nothing is sent without a reason
      await page.locator('[data-testid="eligibility-why"]').fill('Read the certificate: it is valid.');
      await page.locator('[data-testid="eligibility-confirm"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="eligibility-form"]').length === 0);
      expect(posted).toEqual([{ action: 'reclassify', status: 'fit', justification: 'Read the certificate: it is valid.', callException: false }]);
      expect(dialogs).toEqual([]);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(SHOTS, `application-unmet-${width}.png`), fullPage: true });
      await page.close();
    }
  }, 180_000);

  it('a document opens INSIDE the platform, in the data room\'s viewer, on the platform\'s own route — no download, no Storage address; Esc closes; a format it cannot show offers "Download"', async () => {
    const { page, gets, errors } = await open(1280, '?elig=not_fit');
    await openFirst(page);
    await page.locator('[data-testid="eligibility-rule"]').nth(1).locator('[data-testid="open-document"]').click();
    const frame = page.locator('iframe[title="pitch-deck.pdf"]');
    await frame.waitFor();
    const src = (await frame.getAttribute('src'))!;
    expect(src).toMatch(/^\/api\/calls\/c1\/submissions\/a\d+\/documents\/file-deck$/);
    expect(src).not.toMatch(/supabase|storage|signed|token=/i);
    expect(await page.locator('[role="dialog"], .fixed.inset-0').count()).toBeGreaterThan(0);               // the overlay
    expect(gets.some((g) => g.startsWith('GET /api/calls/c1/submissions/') && g.endsWith('/documents/file-deck'))).toBe(true);
    // previous / next between the documents of the application
    await page.locator('button[aria-label="Next document"]').click();
    expect(await page.locator('text=This file type can\'t be previewed here.').count()).toBe(1);
    expect(await page.locator('a:has-text("Download model.xlsx")').getAttribute('href')).toMatch(/^\/api\/calls\/c1\/submissions\/a\d+\/documents\/file-model$/);
    await page.screenshot({ path: path.join(SHOTS, 'document-unsupported-1280.png') });
    await page.locator('button[aria-label="Previous document"]').click();
    await frame.waitFor();
    await page.screenshot({ path: path.join(SHOTS, 'document-viewer-1280.png') });
    await page.keyboard.press('Escape');
    expect(await page.locator('iframe').count()).toBe(0);
    // a file named in the answers opens the same way (not as a link to a new tab)
    await page.locator('[data-testid="answer-files"] [data-testid="open-document"]').first().click();
    await page.locator('iframe[title="pitch-deck.pdf"]').waitFor();
    expect(await page.locator('a[target="_blank"]').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);
});
