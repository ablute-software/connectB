// Prompt 923 (pending item) — the table preview in a REAL browser (the real TableEditor and the real FormPreview, bundled with rolldown): by default it is the table as the applicant sees it on a computer,
// reduced to fit the editor's side panel (never so small that it cannot be read: then it scrolls inside its own box); a Desktop / Phone selector switches to the cards; "Open full preview" opens a
// full-screen copy with the same selector, whose edits go through the same onChange; and the editor's panel and Review & publish are the SAME component. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newField } from '@/lib/calls/form-builder';
import type { FormField, TableConfig } from '@/lib/calls/types';
import { FIT_FLOOR, fitScale } from './TablePreview';

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

describe('fitScale', () => {
  it('never enlarges, never goes under the floor, and survives a measure of zero', () => {
    expect(fitScale(900, 700)).toBe(1);
    expect(fitScale(350, 700)).toBe(0.5);
    expect(fitScale(560, 700)).toBeCloseTo(0.8);
    expect(fitScale(100, 700)).toBe(FIT_FLOOR);
    expect(fitScale(0, 700)).toBe(1);
    expect(fitScale(300, 0)).toBe(1);
  });
});

describe.skipIf(!CHROME)('the table preview (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'table-preview-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/table-preview.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `table-preview-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(kind: 'panel' | 'review', cfg: TableConfig, viewport = 1280, panelWidth = 480) {
    const page = await browser.newPage({ viewport: { width: viewport, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(([k, f, w]) => (window as unknown as { __startPreview: (a: unknown, b: unknown, c: unknown) => void }).__startPreview(k, f, w), [kind, field(cfg), panelWidth] as const);
    await page.waitForSelector('[data-testid="table-preview-box"]');
    await page.waitForTimeout(150);                                                                                       // the measure runs after the first paint
    const fit = () => page.evaluate(() => {
      const o = document.querySelector('[data-testid="fit-outer"]') as HTMLElement; const i = document.querySelector('[data-testid="fit-inner"]') as HTMLElement;
      return { scale: Number(o.dataset.scale), outerClient: o.clientWidth, outerScroll: o.scrollWidth, naturalWidth: i.offsetWidth, shownWidth: i.getBoundingClientRect().width, outerRight: o.getBoundingClientRect().right, innerRight: i.getBoundingClientRect().right };
    });
    const pageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, fit, pageOverflow };
  }

  it('in the editor panel: the table as on a computer is shown by default (no cards), reduced to fit the panel, without its own "Expand table" and without a sideways scroll of the page', async () => {
    const { page, errors, fit, pageOverflow } = await open('panel', config(), 1280, 520);
    expect(await page.locator('[data-testid="table-preview-box"]').getAttribute('data-mode')).toBe('desktop');
    expect(await page.locator('[data-testid="table-preview"] [data-testid="table-grid"]').count()).toBe(1);
    expect(await page.locator('[data-testid="table-preview"] [data-testid="table-card"]').count()).toBe(0);
    expect(await page.locator('[data-testid="table-preview"] [data-testid="expand-table"]').count()).toBe(0);
    expect(await page.locator('[data-testid="preview-mode-desktop"]').getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('[data-testid="open-full-preview"]').innerText()).toBe('Open full preview');
    const f = await fit();
    expect(f.naturalWidth).toBeGreaterThan(f.outerClient);                           // it would not fit as it is…
    expect(f.scale).toBeLessThan(1); expect(f.scale).toBeGreaterThanOrEqual(FIT_FLOOR);
    expect(f.shownWidth).toBeLessThanOrEqual(f.outerClient + 1);                     // …and now it does: reduced
    expect(f.outerScroll).toBeLessThanOrEqual(f.outerClient + 1);                    // nothing scrolls inside it
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    if (process.env.SHOTS_DIR) {                                                                                      // screenshots for the report (never in the normal run)
      await page.locator('[data-testid="table-preview"]').screenshot({ path: path.join(process.env.SHOTS_DIR, 'table-preview-panel-desktop.png') });
      await page.locator('[data-testid="preview-mode-phone"]').click();
      await page.locator('[data-testid="table-preview"]').screenshot({ path: path.join(process.env.SHOTS_DIR, 'table-preview-panel-phone.png') });
    }
    await page.close();
  }, 120_000);

  it('a table too wide to be read when reduced stops at the floor and scrolls INSIDE its own box; the page does not move', async () => {
    const wide = config({ columns: Array.from({ length: 7 }, (_, i) => ({ id: `c_${i}`, label: `Competitor number ${i}` })) });
    const { page, fit, pageOverflow } = await open('panel', wide, 1280, 420);
    const f = await fit();
    expect(f.scale).toBe(FIT_FLOOR);
    expect(f.outerScroll).toBeGreaterThan(f.outerClient);
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
    await page.close();
  }, 120_000);

  it('Phone shows the cards (one per column) in a phone-wide frame; Desktop goes back to the table, and what was typed is kept', async () => {
    const { page, errors } = await open('panel', config(), 1280, 520);
    await page.locator('[data-testid="table-preview"] input[aria-label="Products & Services — Competitor #1"]').fill('typed on the table');
    await page.locator('[data-testid="preview-mode-phone"]').click();
    expect(await page.locator('[data-testid="table-preview-box"]').getAttribute('data-mode')).toBe('phone');
    expect(await page.locator('[data-testid="table-preview"] [data-testid="table-card"]').count()).toBe(3);
    expect(await page.locator('[data-testid="table-preview"] [data-testid="table-grid"]').count()).toBe(0);
    expect(await page.locator('[data-testid="preview-phone-frame"]').evaluate((e) => e.getBoundingClientRect().width)).toBeLessThanOrEqual(375);
    expect(await page.locator('[data-testid="table-card"]').nth(1).locator('input').first().inputValue()).toBe('typed on the table');
    await page.locator('[data-testid="preview-mode-desktop"]').click();
    expect(await page.locator('[data-testid="table-preview"] [data-testid="table-grid"]').count()).toBe(1);
    expect(await page.locator('input[aria-label="Products & Services — Competitor #1"]').inputValue()).toBe('typed on the table');
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('"Open full preview": a full-screen copy at full size with the same selector; typing there changes the preview; Phone inside it; "Done" and Escape go back', async () => {
    const { page, errors } = await open('panel', config(), 1280, 520);
    await page.locator('[data-testid="open-full-preview"]').click();
    await page.waitForSelector('[data-testid="full-preview"]');
    const box = await page.evaluate(() => { const r = document.querySelector('[data-testid="full-preview"]')!.getBoundingClientRect(); return { w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight }; });
    expect(box).toMatchObject({ w: box.vw, h: box.vh });
    const big = await page.locator('[data-testid="full-preview"] [data-testid="table-grid"]').evaluate((t) => t.getBoundingClientRect().width);
    expect(big).toBeGreaterThan(520);                                                                                       // at full size, not reduced
    expect(await page.locator('[data-testid="full-preview"] [data-testid="fit-outer"]').count()).toBe(0);
    await page.locator('[data-testid="full-preview"] input[aria-label="Business Model — Your solution/company"]').fill('typed in the full preview');
    await page.locator('[data-testid="full-preview"] [data-testid="preview-mode-phone"]').click();
    expect(await page.locator('[data-testid="full-preview"] [data-testid="table-card"]').count()).toBe(3);
    await page.locator('[data-testid="full-preview"] [data-testid="preview-mode-desktop"]').click();
    await page.locator('[data-testid="full-preview-done"]').click();
    expect(await page.locator('[data-testid="full-preview"]').count()).toBe(0);
    expect(await page.locator('[data-testid="table-preview"] input[aria-label="Business Model — Your solution/company"]').inputValue()).toBe('typed in the full preview');
    await page.locator('[data-testid="open-full-preview"]').click();
    await page.keyboard.press('Escape');
    expect(await page.locator('[data-testid="full-preview"]').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('Review & publish uses the SAME component: the same selector, the same button, the same table (reduced only a little: the column is wide)', async () => {
    const { page, errors, fit, pageOverflow } = await open('review', config(), 1280);
    // (FormPreview has its own padding inside a 760 px column)
    const scope = '[data-testid="form-preview"] [data-testid="table-preview-box"]';
    expect(await page.locator(scope).count()).toBe(1);
    expect(await page.locator(`${scope} [data-testid="preview-mode"]`).count()).toBe(1);
    expect(await page.locator(`${scope} [data-testid="open-full-preview"]`).innerText()).toBe('Open full preview');
    expect(await page.locator(`${scope} [data-testid="table-grid"]`).count()).toBe(1);
    expect(await page.locator(`${scope} [data-testid="expand-table"]`).count()).toBe(0);
    const f = await fit();
    expect(f.scale).toBeGreaterThanOrEqual(0.8);                                                                            // the form column is wide: only a little reduction
    expect(f.outerScroll).toBeLessThanOrEqual(f.outerClient + 1);
    await page.locator(`${scope} [data-testid="preview-mode-phone"]`).click();
    expect(await page.locator(`${scope} [data-testid="table-card"]`).count()).toBe(3);
    await page.locator(`${scope} [data-testid="open-full-preview"]`).click();
    expect(await page.locator('[data-testid="full-preview"] [data-testid="table-card"]').count()).toBe(3);                // the mode is shared with the full preview
    await page.locator('[data-testid="full-preview-done"]').click();
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);
});
