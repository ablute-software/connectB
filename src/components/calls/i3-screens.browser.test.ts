// Prompt 924 (Etapa 4, I3) — the three screens of this increment in a REAL browser (the real components bundled with rolldown; the server is a stub that applies the real pure rules): what an applicant sees for a "Not selected"
// (contest it, once, with a written reason and at most one PDF — the confirmation written in the page — and afterwards what became of it); the queue of whoever handles contestations (Upheld says what the decision
// becomes, Rejected needs a written response; the file is a link on this platform); and Results → Close (complete with the name typed in the page, the export, the retention with its warning and its one postponement).
// Nothing wider than the screen at 375, 768 and 1280, and no browser dialog. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CloseView, ContestInfo, ContestationRow } from '@/lib/calls/contestations';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const NAME = 'Seed Call 2027';
const STUBS: Record<string, string> = { '@/lib/supabase': 'test/supabase-browser-stub.ts' };

const AVAILABLE: ContestInfo = { state: 'available', deadline: '2026-11-11T10:00:00.000Z', contestation: null };
const row = (over: Partial<ContestationRow> = {}): ContestationRow => ({
  id: 'c1', applicationId: 'a1', reference: 'REF-002', startupName: 'Cyan Labs with a very long name that has to wrap inside its own box on a phone', status: 'open', reason: 'The financial model was misread: the second year was in the annex.\nPlease look again.',
  fileName: 'annex.pdf', hasFile: true, createdAt: '2026-11-03T09:00:00.000Z', answeredAt: null, response: null, result: { label: 'Not selected', kind: 'reject', publishedAt: '2026-11-01T10:00:00.000Z' },
  evaluation: { gradePercent: 48.5, evaluators: 2, criteria: [{ name: 'Team', average: 3.5 }, { name: 'Market', average: 4 }], decision: 'reject', decisionNote: 'Weak second year' }, newLabel: null, ...over,
});

describe.skipIf(!CHROME)('the screens of contestations and of closing a call (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i3-screens-'));
    const src = path.join(process.cwd(), 'src');
    await build({
      input: path.join(src, 'components/calls/i3-screens.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      plugins: [{ name: 'test-stubs', resolveId(source: string) { return STUBS[source] ? path.join(src, STUBS[source]) : null; } }],
      resolve: { alias: { '@': src } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js', banner: 'var process = typeof process !== "undefined" ? process : { env: {} };' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `i3-screens-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(opts: unknown, ready: string, width = 1280) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = []; const dialogs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route('http://app.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto('http://app.test/calls');
    await page.addScriptTag({ content: bundle });
    await page.evaluate((o) => (window as unknown as { __startI3: (x: unknown) => void }).__startI3(o), opts);
    await page.waitForSelector(ready);
    const requests = () => page.evaluate(() => (window as unknown as { __i3Requests: { method: string; url: string; body: Record<string, unknown> }[] }).__i3Requests);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, requests, overflow };
  }

  it('an applicant with a "Not selected": the deadline, a button; the form needs a reason; sending is confirmed IN THE PAGE; afterwards it says "under review" and shows their reason — once only', async () => {
    const { page, dialogs, requests, errors } = await open({ screen: 'applicant', contest: AVAILABLE }, '[data-testid="applicant-result"]');
    expect(await page.locator('[data-testid="result-label"]').innerText()).toBe('Not selected');
    expect(await page.locator('[data-testid="contest-box"]').innerText()).toContain('You can contest this decision until 11 Nov 2026');
    await page.locator('[data-testid="contest-open"]').click();
    expect(await page.locator('[data-testid="contest-confirm"]').innerText()).toBe('Send your contestation? You can contest only once and it cannot be edited afterwards.');
    await page.locator('[data-testid="contest-send"]').click();
    expect(await page.locator('[data-testid="contest-error"]').innerText()).toBe('Write the reason for your contestation.');
    await page.locator('[data-testid="contest-reason"]').fill('The financial model was misread.');
    await page.locator('[data-testid="contest-send"]').click();
    await page.waitForSelector('[data-testid="contestation-status"]');
    expect(await page.locator('[data-testid="contestation-status"]').innerText()).toContain('Contestation under review');
    expect(await page.locator('[data-testid="contestation-status"]').innerText()).toContain('The financial model was misread.');
    expect(await page.locator('[data-testid="contest-open"]').count()).toBe(0);                                  // once
    expect((await requests()).filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([{ reason: 'The financial model was misread.' }]);
    expect(dialogs).toEqual([]); expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('a PDF can be attached (uploaded to the startup\'s own folder first); anything else is refused before it leaves the browser', async () => {
    const { page, requests } = await open({ screen: 'applicant', contest: AVAILABLE }, '[data-testid="applicant-result"]');
    await page.locator('[data-testid="contest-open"]').click();
    await page.locator('[data-testid="contest-reason"]').fill('See the annex.');
    await page.locator('[data-testid="contest-file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await page.locator('[data-testid="contest-send"]').click();
    expect(await page.locator('[data-testid="contest-error"]').innerText()).toBe('Only a PDF file can be attached.');
    await page.locator('[data-testid="contest-file"]').setInputFiles({ name: 'annex.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') });
    await page.locator('[data-testid="contest-send"]').click();
    await page.waitForSelector('[data-testid="contestation-status"]');
    const uploads = await page.evaluate(() => (window as unknown as { __uploads: { path: string; name: string }[] }).__uploads);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(/^org-1\/calls\/app-1\/contest-.+-annex\.pdf$/);
    const post = (await requests()).find((r) => r.method === 'POST')!;
    expect(post.body).toMatchObject({ reason: 'See the annex.', fileName: 'annex.pdf' });
    expect(String(post.body.storagePath)).toBe(uploads[0].path);
    expect(await page.locator('[data-testid="contestation-status"]').innerText()).toContain('Attached: annex.pdf');
    await page.close();
  }, 120_000);

  it('after the period, nothing to click; with no contestations offered, nothing at all; an answered one shows the response', async () => {
    const expired = await open({ screen: 'applicant', contest: { state: 'expired', deadline: '2026-11-11T10:00:00.000Z', contestation: null } }, '[data-testid="applicant-result"]');
    expect(await expired.page.locator('[data-testid="contest-expired"]').innerText()).toContain('The period to contest this decision ended on');
    expect(await expired.page.locator('[data-testid="contest-open"]').count()).toBe(0);
    await expired.page.close();
    const none = await open({ screen: 'applicant', contest: { state: 'not_offered', deadline: null, contestation: null } }, '[data-testid="applicant-result"]');
    expect(await none.page.locator('[data-testid="contest-box"], [data-testid="contest-expired"], [data-testid="contestation-status"]').count()).toBe(0);
    await none.page.close();
    const answered = await open({ screen: 'applicant', contest: { state: 'done', deadline: '2026-11-11T10:00:00.000Z', contestation: { status: 'rejected', reason: 'Please review.', response: 'The decision stands.', answeredAt: '2026-11-05T10:00:00.000Z', hasFile: false, fileName: null } } }, '[data-testid="applicant-result"]');
    expect(await answered.page.locator('[data-testid="contestation-response"]').innerText()).toBe('The decision stands.');
    await answered.page.close();
  }, 120_000);

  it('the queue: the application, the reason, the file as a link on this platform, the evaluation as numbers; Upheld says what the decision becomes and confirms in the page; the answer appears with the new result', async () => {
    const { page, requests, dialogs } = await open({ screen: 'contestations', rows: [row(), row({ id: 'c2', reference: 'REF-004', startupName: 'Red Ltd', hasFile: false, fileName: null, evaluation: null })] }, '[data-testid="contestations-panel"]');
    expect(await page.locator('[data-testid="contestations-count"]').innerText()).toBe('2 waiting for an answer · 2 in all');
    const first = page.locator('[data-testid="contestation"]').first();
    expect(await first.locator('[data-testid="contestation-reason"]').innerText()).toContain('the second year was in the annex.');
    expect(await first.locator('[data-testid="contestation-file"]').getAttribute('href')).toBe('/api/calls/call-1/contestations/c1/file');
    expect(await first.locator('[data-testid="contestation-evaluation"]').innerText()).toContain('Average 48.5% · 2 evaluations · decision: reject (“Weak second year”)');
    expect(await first.locator('[data-testid="contestation-evaluation"]').innerText()).toContain('Team: 3.5');
    await first.locator('[data-testid="answer-upheld"]').click();
    expect(await first.locator('[data-testid="answer-sentence"]').innerText()).toBe('Accept this contestation? The decision becomes “Selected”, the applicant is told with a new result, and the earlier one is kept. This cannot be undone.');
    await first.locator('[data-testid="new-waitlist"]').check();
    expect(await first.locator('[data-testid="answer-sentence"]').innerText()).toContain('becomes “Waiting list”');
    await first.locator('[data-testid="answer-response"]').fill('You were right.');
    await first.locator('[data-testid="answer-send"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="contestation"]')!.getAttribute('data-status') === 'upheld');
    expect(await first.locator('[data-testid="contestation-answer"]').innerText()).toContain('the applicant now has “Waiting list”');
    expect((await requests()).filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([{ action: 'answer', contestationId: 'c1', outcome: 'upheld', newResult: 'waitlist', response: 'You were right.' }]);
    expect(await page.locator('[data-testid="contestations-count"]').innerText()).toBe('1 waiting for an answer · 2 in all');
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('Rejected: the button stays off until a response is written; then it is sent; contestations switched off say so', async () => {
    const { page, requests } = await open({ screen: 'contestations', rows: [row()] }, '[data-testid="contestations-panel"]');
    await page.locator('[data-testid="answer-rejected"]').click();
    expect(await page.locator('[data-testid="answer-send"]').isDisabled()).toBe(true);
    expect(await page.locator('[data-testid="new-advance"]').count()).toBe(0);
    await page.locator('[data-testid="answer-response"]').fill('The decision stands.');
    expect(await page.locator('[data-testid="answer-send"]').isDisabled()).toBe(false);
    await page.locator('[data-testid="answer-send"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="contestation"]')!.getAttribute('data-status') === 'rejected');
    expect((await requests()).filter((r) => r.method === 'POST')[0].body).toMatchObject({ outcome: 'rejected', response: 'The decision stands.' });
    await page.close();
    const off = await open({ screen: 'contestations', enabled: false, rows: [] }, '[data-testid="contestations-panel"]');
    expect(await off.page.locator('[data-testid="contestations-off"]').innerText()).toContain('Contestations are switched off for this call.');
    expect(await off.page.locator('[data-testid="contestations-count"]').innerText()).toBe('No applicant has contested a decision.');
    await off.page.close();
  }, 120_000);

  it('Close: blockers in words; with none, the name is typed in the page to complete; afterwards it is read-only, with the date the data goes', async () => {
    const blocked = await open({ screen: 'close', close: { canComplete: false, blockers: [{ code: 'open_contestations', text: '1 contestation is still waiting for an answer.' }] } }, '[data-testid="close-panel"]');
    expect(await blocked.page.locator('[data-testid="blocker-open_contestations"]').innerText()).toBe('1 contestation is still waiting for an answer.');
    expect(await blocked.page.locator('[data-testid="complete-button"]').count()).toBe(0);
    await blocked.page.close();
    const { page, requests, dialogs } = await open({ screen: 'close', close: {} }, '[data-testid="close-panel"]');
    expect(await page.locator('[data-testid="complete-sentence"]').innerText()).toBe('Complete this call? Everything becomes read-only. This cannot be undone.');
    expect(await page.locator('[data-testid="complete-button"]').isDisabled()).toBe(true);
    await page.locator('[data-testid="complete-name"]').fill(`  ${NAME.toUpperCase()} `);
    await page.locator('[data-testid="complete-button"]').click();
    await page.waitForSelector('[data-testid="completed-box"]');
    expect(await page.locator('[data-testid="completed-box"]').innerText()).toContain('Everything in it is read-only.');
    expect(await page.locator('[data-testid="complete-box"]').count()).toBe(0);
    expect(await page.locator('[data-testid="retention-sentence"]').innerText()).toContain('Kept for 24 months after the call was completed: deleted on');
    expect((await requests()).filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([{ action: 'complete', confirmName: `  ${NAME.toUpperCase()} ` }]);
    expect(await page.locator('[data-testid="export-csv"]').getAttribute('href')).toBe('/api/calls/call-1/results/export?format=csv');
    expect(await page.locator('[data-testid="export-xlsx"]').getAttribute('href')).toBe('/api/calls/call-1/results/export?format=xlsx');
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('Retention: the warning in the last 30 days, the postponement with a reason — once — and what it says afterwards', async () => {
    const soon = new Date(Date.now() + 12 * 86_400_000).toISOString();
    const close: Partial<CloseView> = { status: 'completed', canComplete: false, completedAt: '2026-11-20T10:00:00.000Z', retention: { phase: 'warn', purgeAfter: soon, daysLeft: 12, canPostpone: true, extendedAt: null, months: 24, reason: null } };
    const { page, requests } = await open({ screen: 'close', close }, '[data-testid="retention-box"]');
    expect(await page.locator('[data-testid="retention-warning"]').innerText()).toContain('less than 30 days');
    await page.locator('[data-testid="postpone-open"]').click();
    await page.locator('[data-testid="postpone-reason"]').fill('ok');
    expect(await page.locator('[data-testid="postpone-send"]').isDisabled()).toBe(true);
    await page.locator('[data-testid="postpone-reason"]').fill('We need it for the audit.');
    await page.locator('[data-testid="postpone-send"]').click();
    await page.waitForSelector('[data-testid="retention-postponed"]');
    expect(await page.locator('[data-testid="retention-postponed"]').innerText()).toContain('Postponed once on 21 Nov 2026: “We need it for the audit.”');
    expect(await page.locator('[data-testid="retention-postponed"]').innerText()).toContain('It cannot be postponed again.');
    expect(await page.locator('[data-testid="postpone-open"]').count()).toBe(0);
    expect((await requests()).filter((r) => r.method === 'POST')[0].body).toEqual({ action: 'postpone', reason: 'We need it for the audit.' });
    await page.close();
  }, 120_000);

  it('nothing is wider than the screen at 375, 768 and 1280', async () => {
    for (const width of [375, 768, 1280]) {
      const a = await open({ screen: 'applicant', contest: AVAILABLE }, '[data-testid="applicant-result"]', width);
      await a.page.locator('[data-testid="contest-open"]').click();
      expect(await a.overflow(), `applicant ${width}`).toBeLessThanOrEqual(0);
      if (process.env.SHOTS_DIR) await a.page.screenshot({ path: path.join(process.env.SHOTS_DIR, `contest-applicant-${width}.png`), fullPage: true });
      await a.page.close();
      const c = await open({ screen: 'contestations', rows: [row(), row({ id: 'c2', status: 'upheld', answeredAt: '2026-11-05T10:00:00Z', response: 'You were right.', newLabel: 'Waiting list' })] }, '[data-testid="contestations-panel"]', width);
      await c.page.locator('[data-testid="answer-upheld"]').first().click();
      expect(await c.overflow(), `queue ${width}`).toBeLessThanOrEqual(0);
      if (process.env.SHOTS_DIR) await c.page.screenshot({ path: path.join(process.env.SHOTS_DIR, `contestations-${width}.png`), fullPage: true });
      await c.page.close();
      const k = await open({ screen: 'close', close: { status: 'completed', canComplete: false, completedAt: '2026-11-20T10:00:00.000Z', retention: { phase: 'warn', purgeAfter: new Date(Date.now() + 12 * 86_400_000).toISOString(), daysLeft: 12, canPostpone: true, extendedAt: null, months: 24, reason: null } } }, '[data-testid="close-panel"]', width);
      expect(await k.overflow(), `close ${width}`).toBeLessThanOrEqual(0);
      if (process.env.SHOTS_DIR) await k.page.screenshot({ path: path.join(process.env.SHOTS_DIR, `results-close-${width}.png`), fullPage: true });
      await k.page.close();
    }
  }, 240_000);
});
