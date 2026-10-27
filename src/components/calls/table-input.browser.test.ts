// Prompt 917 (Adenda 2, B2) — the applicant's table in a REAL browser (the real TableInput, bundled with rolldown; no jsdom, no dev server): the entity's headers are fixed and have no ✕, the
// applicant's own column can be renamed and removed (asking first when it holds something), the maximum is respected, "Expand table" opens a full-screen copy whose edits go through the same
// onChange (so the draft keeps saving) with the first column and the header row staying in place, and on a phone the table is cards. The page never scrolls sideways. Without a Chrome
// (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newField } from '@/lib/calls/form-builder';
import type { FormField, TableConfig } from '@/lib/calls/types';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));

const config = (over: Partial<TableConfig> = {}): TableConfig => ({
  cornerTitle: 'Relevant Criteria',
  rows: [{ id: 'r_prod', label: 'Products & Services' }, { id: 'r_biz', label: 'Business Model' }, { id: 'r_share', label: 'Market Share (%)' }],
  columns: [{ id: 'c_you', label: 'Your solution/company' }, { id: 'c_1', label: 'Competitor #1' }, { id: 'c_2', label: 'Competitor #2' }],
  cellKind: 'short_text', rowKinds: { r_share: 'percent' },
  addColumns: { allowed: true, max: 5, defaultName: 'Competitor #' }, addRows: { allowed: false, max: 3, defaultName: 'Row #' }, required: 'none', ...over,
});
const field = (cfg: TableConfig): FormField => ({ ...newField('table', 1, 0), id: 'tbl-field-1', label: 'Competitive analysis', validations: { table: cfg } });
const WIDTHS = [1280, 768, 375] as const;
type Answer = { columns: { id: string; name: string }[]; rows: unknown[]; cells: Record<string, Record<string, string>> } | null;

describe.skipIf(!CHROME)('the applicant\'s table (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    // A variable specifier: the compiler does not load rolldown's type definitions into every typecheck of the project.
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'table-input-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/table-input.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `table-input-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); });

  async function open(width: number, cfg: TableConfig, initial: unknown = null, opts: { disabled?: boolean } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 700 });
    const errors: string[] = []; const dialogs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const answerYes = { value: true };
    page.on('dialog', (d) => { dialogs.push(d.message()); void (answerYes.value ? d.accept() : d.dismiss()); });
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(([f, v, o]) => (window as unknown as { __startTable: (a: unknown, b: unknown, c: unknown) => void }).__startTable(f, v, o), [field(cfg), initial, opts] as const);
    await page.waitForSelector('[data-testid="table-input"]');
    const answer = () => page.evaluate(() => (window as unknown as { __answer: Answer }).__answer);
    const changes = () => page.evaluate(() => (window as unknown as { __changes: number }).__changes);
    const pageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, answer, changes, pageOverflow, answerYes };
  }

  it('at 1280: the entity\'s headers are plain text with no ✕; "+ Add column" adds "Competitor #3", which can be renamed and removed; the maximum disables the button', async () => {
    const { page, errors, dialogs, answer, pageOverflow } = await open(1280, config());
    expect(await page.locator('[data-testid="table-grid"] thead th').allInnerTexts()).toEqual(['Relevant Criteria', 'Your solution/company', 'Competitor #1', 'Competitor #2']);
    expect(await page.locator('[data-testid="remove-column"], [data-testid="remove-row"]').count()).toBe(0);
    expect(await page.locator('[data-testid="table-grid"] thead textarea, [data-testid="table-grid"] thead input').count()).toBe(0);           // not editable
    await page.locator('[data-testid="add-column"]').click();
    expect((await answer())!.columns.map((c) => c.name)).toEqual(['Competitor #3']);
    expect(await page.locator('[data-testid="remove-column"]').count()).toBe(1);                                                                     // only the new one has a ✕
    await page.locator('textarea[aria-label^="Name of column"]').fill('Acme Corp');
    await page.locator('input[aria-label="Products & Services — Acme Corp"]').fill('Fast');
    const ownId = (await answer())!.columns[0].id;
    expect((await answer())!.columns[0].name).toBe('Acme Corp');
    expect((await answer())!.cells.r_prod[ownId]).toBe('Fast');
    // removing a column that holds something asks first; a "no" keeps everything, a "yes" removes the column and its cells
    await page.locator('[data-testid="remove-column"]').click();
    expect(await page.locator('[data-testid="remove-confirm"]').innerText()).toContain('Remove “Acme Corp” and what you wrote in it?');
    await page.locator('[data-testid="remove-confirm-no"]').click();
    expect((await answer())!.columns).toHaveLength(1);                                                                                               // "Keep": nothing changed
    await page.locator('[data-testid="remove-column"]').click();
    await page.locator('[data-testid="remove-confirm-yes"]').click();
    expect(await answer()).toBeNull();                                                                                                                // nothing left: no answer
    // the maximum (5 in all, 3 are the entity's): two more, then the button is off
    await page.locator('[data-testid="add-column"]').click(); await page.locator('[data-testid="add-column"]').click();
    expect(await page.locator('[data-testid="add-column"]').isDisabled()).toBe(true);
    expect((await answer())!.columns.map((c) => c.name)).toEqual(['Competitor #3', 'Competitor #4']);
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    expect(dialogs).toEqual([]);                                                                                                                      // nothing depends on a browser pop-up
    await page.close();
  }, 120_000);

  it('"Expand table": a full-screen copy, the same onChange (the draft keeps saving), the first column and the header row stay in place; "Done" goes back', async () => {
    const { page, changes, answer } = await open(1280, config());
    await page.locator('[data-testid="expand-table"]').click();
    await page.waitForSelector('[data-testid="table-expanded"]');
    const before = await changes();
    await page.locator('[data-testid="table-expanded"] input[aria-label="Products & Services — Your solution/company"]').fill('Typed in the big table');
    expect(await changes()).toBeGreaterThan(before);
    expect((await answer())!.cells.r_prod.c_you).toBe('Typed in the big table');
    const sticky = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="table-expanded"]')!;
      const th = root.querySelector('thead th:nth-child(2)') as HTMLElement; const first = root.querySelector('tbody th') as HTMLElement;
      return { head: getComputedStyle(th).position, firstCol: getComputedStyle(first).position, box: root.getBoundingClientRect().width, vw: window.innerWidth };
    });
    expect(sticky).toMatchObject({ head: 'sticky', firstCol: 'sticky' });
    expect(sticky.box).toBe(sticky.vw);
    await page.locator('[data-testid="table-done"]').click();
    expect(await page.locator('[data-testid="table-expanded"]').count()).toBe(0);
    expect(await page.locator('[data-testid="table-grid"] input[aria-label="Products & Services — Your solution/company"]').inputValue()).toBe('Typed in the big table');
    await page.close();
  }, 120_000);

  it('the page never scrolls sideways: the table scrolls INSIDE its own box at 768', async () => {
    const many = config({ columns: Array.from({ length: 6 }, (_, i) => ({ id: `c_${i}`, label: `Competitor number ${i} with a long name` })) });
    const { page, pageOverflow } = await open(768, many);
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
    const box = await page.evaluate(() => { const b = document.querySelector('[data-testid="table-scroll"]') as HTMLElement; return { scroll: b.scrollWidth, client: b.clientWidth }; });
    expect(box.scroll).toBeGreaterThan(box.client);
    await page.close();
  }, 120_000);

  it('at 375: one card per column with the criteria as its fields; the buttons to add and remove are there; nothing is wider than the screen', async () => {
    const { page, answer, pageOverflow, errors } = await open(375, config());
    expect(await page.locator('[data-testid="table-card"]').count()).toBe(3);
    expect(await page.locator('[data-testid="table-grid"]').count()).toBe(0);
    expect(await page.locator('[data-testid="table-card"]').first().locator('legend').innerText()).toBe('Your solution/company');
    await page.locator('[data-testid="add-column"]').click();
    expect(await page.locator('[data-testid="table-card"]').count()).toBe(4);
    expect(await page.locator('[data-testid="remove-column"]').count()).toBe(1);
    await page.locator('[data-testid="table-card"]').nth(1).locator('input').first().fill('theirs');
    expect((await answer())!.cells.r_prod.c_1).toBe('theirs');
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('a read-only copy (a submitted application) has no buttons and marks what the applicant added', async () => {
    const answer = { columns: [{ id: 'x_mine00001', name: 'Competitor #3', addedBy: 'applicant' }], rows: [], cells: { r_prod: { c_you: 'ours', x_mine00001: 'third' } } };
    for (const width of WIDTHS) {
      const { page, pageOverflow } = await open(width, config(), answer, { disabled: true });
      expect(await page.locator('[data-testid="add-column"], [data-testid="remove-column"], textarea[aria-label^="Name of"]').count(), `${width}`).toBe(0);
      expect(await page.locator('[data-testid="added-by-applicant"]').count()).toBeGreaterThan(0);
      expect(await pageOverflow()).toBeLessThanOrEqual(0);
      await page.close();
    }
  }, 120_000);
});
