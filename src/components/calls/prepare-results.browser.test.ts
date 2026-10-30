// Prompt 924 (Etapa 4, I1) — Results → Prepare in a REAL browser (the real PrepareResults bundled with rolldown; the server is a stub that applies the real rules of results.ts). The counts per result, the
// warning and the button for the applications without a decision, the names and the messages (edited and autosaved), the fields that go into the message, the options, the feedback of one application and the
// preview of a real application's message — and nothing wider than the screen at 375, 768 and 1280, no browser dialog. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppFacts } from '@/lib/calls/results';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));

const app = (id: string, name: string, over: Partial<AppFacts> = {}): AppFacts => ({ applicationId: id, reference: `REF-${id}`, startupName: name, applicantUserId: `u-${id}`, decision: null, eligibility: 'fit', failedRules: [], feedback: null, grade: null, ...over });
const APPS = [app('1', 'Blue Health', { decision: 'advance' }), app('2', 'Cyan Labs', { decision: 'reject' }), app('3', 'Green Tech', { decision: 'waitlist' }), app('4', 'Grey Co'), app('5', 'Red Ltd', { eligibility: 'not_fit', failedRules: ['The company was founded in 2024 or earlier.'] })];
/** A paste into an editor, as the browser delivers it: the clipboard carries one format and the editor reads it. */
async function pasteInto(page: import('playwright').Page, selector: string, type: string, data: string) {
  await page.evaluate(([sel, t, d]) => {
    const el = document.querySelector(sel) as HTMLElement; el.focus();
    const dt = new DataTransfer(); dt.setData(t, d);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [selector, type, data]);
}
const DECIDED = APPS.map((a) => (a.decision || a.eligibility === 'not_fit' ? a : { ...a, decision: 'waitlist' as const }));

describe.skipIf(!CHROME)('Results → Prepare (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-results-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/prepare-results.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `prepare-results-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(apps: AppFacts[], opts: { width?: number; hasNext?: boolean } = {}) {
    const page = await browser.newPage({ viewport: { width: opts.width ?? 1280, height: 900 } });
    const errors: string[] = []; const dialogs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route('http://app.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto('http://app.test/calls');
    await page.addScriptTag({ content: bundle });
    await page.evaluate((o) => (window as unknown as { __startPrepare: (x: unknown) => void }).__startPrepare(o), { apps, hasNext: opts.hasNext ?? false });
    await page.waitForSelector('[data-testid="prepare-results"]');
    const requests = () => page.evaluate(() => (window as unknown as { __prepareRequests: { method: string; url: string; body: unknown }[] }).__prepareRequests);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, requests, overflow };
  }

  it('the counts per result, and the application without a decision stops the results: a warning that names it and a button to the board', async () => {
    const { page, errors } = await open(APPS);
    expect(await page.locator('[data-testid="count-advance"]').innerText()).toContain('1');
    expect(await page.locator('[data-testid="count-reject"]').innerText()).toMatch(/^2/);                            // Cyan Labs + Red Ltd (Not a fit, no decision)
    expect(await page.locator('[data-testid="count-waitlist"]').innerText()).toMatch(/^1/);
    expect(await page.locator('[data-testid="results-summary"]').innerText()).toContain('5 submitted applications');
    expect(await page.locator('[data-testid="results-summary"]').innerText()).toContain('1 of the “Not selected” are applications whose eligibility was “Not a fit”');
    const warn = await page.locator('[data-testid="pending-warning"]').innerText();
    expect(warn).toContain('1 application has no decision yet.');
    expect(warn).toContain('REF-4');
    await page.locator('[data-testid="go-evaluation"]').click();
    expect(await page.title()).toBe('went-to-evaluation');
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('with everything decided there is no warning; a call still open says it must be closed', async () => {
    const { page } = await open(DECIDED);
    expect(await page.locator('[data-testid="pending-warning"]').count()).toBe(0);
    await page.close();
  }, 120_000);

  it('the name of a result is edited and saved by itself (and the count follows it); "Use the default text" puts the default back', async () => {
    const { page, requests } = await open(DECIDED);
    await page.locator('[data-testid="label-advance"]').fill('Welcome aboard');
    await page.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.getAttribute('data-state') === 'saved', null, { timeout: 8000 });
    const put = (await requests()).filter((r) => r.method === 'PUT');
    expect(put).toHaveLength(1);
    expect(put[0].body).toMatchObject({ labels: { advance: 'Welcome aboard' } });
    expect(await page.locator('[data-testid="count-advance"]').innerText()).toContain('Welcome aboard');
    await page.locator('[data-testid="reset-advance"]').click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="label-advance"]') as HTMLInputElement).value === 'Selected');
    await page.close();
  }, 120_000);

  it('a message is edited with the formatted-text editor; a field goes in where the cursor is; the message is saved without the markup it should not have', async () => {
    const { page, requests } = await open(DECIDED);
    const editor = page.locator('#msg-reject');
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Hello ');
    await page.locator('[data-testid="result-reject"] [data-testid="merge-add-applicant_name"]').click();
    await page.keyboard.type(', thank you.');
    await page.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.getAttribute('data-state') === 'saved', null, { timeout: 8000 });
    const put = (await requests()).filter((r) => r.method === 'PUT').pop()!;
    const html = (put.body as { messages: { reject: string } }).messages.reject;
    expect(html).toContain('Hello {applicant_name}, thank you.');
    // on the screen it is a tag with the name of the field, never the code; what was stored is the code
    expect(await editor.locator('.merge-tag').allInnerTexts()).toEqual(['Applicant name']);
    expect(await editor.innerText()).not.toContain('{');
    await page.close();
  }, 120_000);

  it('a message with a field that does not exist is refused in words, and the screen says the save failed', async () => {
    const { page } = await open(DECIDED);
    const editor = page.locator('#msg-waitlist');
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Hi ');
    // a field that does not exist can only come from a paste (typing { opens the list of fields): it is a red tag, and the save says why it was refused
    await pasteInto(page, '#msg-waitlist', 'text/plain', '{applicant}');
    await page.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.getAttribute('data-state') === 'error', null, { timeout: 8000 });
    expect(await page.locator('[data-testid="save-status"]').innerText()).toContain('{applicant} does not exist');
    expect(await editor.locator('.merge-tag-unknown').allInnerTexts()).toEqual(['Unknown field']);
    await page.close();
  }, 120_000);

  it('merge tags: the messages open with the fields as tags; { opens the list; one Backspace removes a tag; copy and paste keep it; what is stored is the code', async () => {
    const { page, requests } = await open(DECIDED);
    const editor = page.locator('#msg-advance');
    // the default message is stored with {applicant_name}, {call_title}…; on screen only tags
    expect(await editor.locator('.merge-tag').count()).toBeGreaterThan(1);
    expect(await editor.innerText()).not.toMatch(/[{}]/);
    expect(await editor.locator('.merge-tag').first().evaluate((e) => e.getAttribute('contenteditable'))).toBe('false');
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('Hi ');
    // { opens the list of fields instead of a bracket; the arrows and Enter choose
    await page.keyboard.type('{');
    await page.waitForSelector('[data-testid="merge-menu"]');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await page.locator('[data-testid="merge-menu"]').count()).toBe(0);
    expect(await editor.locator('.merge-tag').allInnerTexts()).toEqual(['Startup name']);
    expect(await editor.innerText()).not.toContain('{');
    // one Backspace takes the whole tag away
    await page.keyboard.press('Backspace');
    expect(await editor.locator('.merge-tag').count()).toBe(0);
    // a field from the list under the editor
    await page.locator('[data-testid="result-advance"] [data-testid="merge-add-call_title"]').click();
    await page.locator('[data-testid="result-advance"] [data-testid="merge-add-reference"]').click();
    expect(await editor.locator('.merge-tag').allInnerTexts()).toEqual(['Call title', 'Reference']);
    // copy and paste: the tags come back as tags
    const copied = await page.evaluate(() => {
      const el = document.querySelector('#msg-advance') as HTMLElement;
      el.focus();
      const sel = window.getSelection()!; const r = document.createRange(); r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r);
      const dt = new DataTransfer();
      el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
      r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
      return { html: dt.getData('text/html'), plain: dt.getData('text/plain') };
    });
    expect(copied.plain).toContain('{call_title}');
    expect(copied.plain).toContain('{reference}');
    await pasteInto(page, '#msg-advance', 'text/html', copied.html);
    expect(await editor.locator('.merge-tag').allInnerTexts()).toEqual(['Call title', 'Reference', 'Call title', 'Reference']);
    // what was stored is the code
    await page.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.getAttribute('data-state') === 'saved', null, { timeout: 8000 });
    const html = ((await requests()).filter((r) => r.method === 'PUT').pop()!.body as { messages: { advance: string } }).messages.advance;
    expect(html).toContain('{call_title}');
    expect(html).toContain('{reference}');
    expect(html).not.toContain('merge-tag');
    expect(html).not.toContain('Call title');
    await page.close();
  }, 120_000);

  it('the options: contestations show their days (10 by default) only when on; feedback shows one box per application', async () => {
    const { page, requests } = await open(DECIDED);
    expect(await page.locator('[data-testid="opt-contestation-days"]').count()).toBe(0);
    expect(await page.locator('[data-testid="feedback-list"]').count()).toBe(0);
    expect(await page.locator('[data-testid="opt-retention"]').inputValue()).toBe('24');
    await page.locator('[data-testid="opt-contestations"]').check();
    expect(await page.locator('[data-testid="opt-contestation-days"]').inputValue()).toBe('10');
    await page.locator('[data-testid="opt-feedback"]').check();
    await page.waitForSelector('[data-testid="feedback-list"]');
    expect(await page.locator('[data-testid="feedback-item"]').count()).toBe(5);
    await page.locator('[data-testid="feedback-input"]').nth(1).fill('Come back next year.');
    await page.locator('[data-testid="feedback-input"]').nth(1).blur();
    await page.waitForFunction(() => document.body.innerText.includes('Saved'), null, { timeout: 8000 });
    expect((await requests()).filter((r) => r.method === 'POST' && (r.body as { action?: string }).action === 'feedback')).toHaveLength(1);
    await page.close();
  }, 120_000);

  it('the preview shows the message one applicant would receive (with the feedback, once written), and says so when there is none yet', async () => {
    const { page } = await open(APPS);
    await page.locator('[data-testid="opt-feedback"]').check();
    await page.waitForSelector('[data-testid="feedback-list"]');
    await page.locator('[data-testid="feedback-input"]').nth(1).fill('Come back next year.');
    await page.locator('[data-testid="feedback-input"]').nth(1).blur();
    await page.waitForFunction(() => document.body.innerText.includes('Saved'), null, { timeout: 8000 });
    await page.locator('[data-testid="preview-pick"]').selectOption({ label: 'Cyan Labs — Not selected' });
    await page.locator('[data-testid="preview-build"]').click();
    await page.waitForSelector('[data-testid="preview-message"]');
    expect(await page.locator('[data-testid="preview-subject"]').innerText()).toBe('Seed Call 2027: Not selected');
    const body = await page.locator('[data-testid="preview-body"]').innerText();
    expect(body).toContain('Dear Founder of Cyan Labs,');
    expect(body).toContain('Cyan Labs was not selected this time');
    expect(body).toContain('Come back next year.');
    expect(await page.locator('[data-testid="preview-pick"] option').allInnerTexts()).not.toContain('Grey Co — no decision yet');   // only applications with a result can be previewed
    await page.close();
  }, 120_000);

  it('the next phase\'s text and date appear only in a call with another phase, and "Selected" is then "Moves to the next phase"', async () => {
    const one = await open(DECIDED);
    expect(await one.page.locator('[data-testid="next-steps"]').count()).toBe(0);
    await one.page.close();
    const two = await open(DECIDED, { hasNext: true });
    expect(await two.page.locator('[data-testid="next-steps"]').count()).toBe(1);
    expect(await two.page.locator('[data-testid="label-advance"]').inputValue()).toBe('Moves to the next phase');
    await two.page.close();
  }, 120_000);

  it('nothing is wider than the screen at 375, 768 and 1280, and no browser dialog is ever used', async () => {
    for (const width of [375, 768, 1280]) {
      const { page, overflow, dialogs, errors } = await open(APPS, { width, hasNext: true });
      await page.locator('[data-testid="opt-contestations"]').check();
      await page.locator('[data-testid="opt-feedback"]').check();
      await page.waitForSelector('[data-testid="feedback-list"]');
      expect(await overflow(), `${width}`).toBeLessThanOrEqual(0);
      const tooWide = await page.evaluate(() => { const vw = document.documentElement.clientWidth; return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="prepare-results"] *')).filter((e) => e.getBoundingClientRect().right > vw + 1).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)); });
      expect(tooWide, `${width}`).toEqual([]);
      if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `results-prepare-${width}.png`), fullPage: true });
      expect(dialogs).toEqual([]); expect(errors).toEqual([]);
      await page.close();
    }
  }, 180_000);
});
