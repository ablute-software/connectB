// Prompt 927 (C) — follow-up (dependent) questions in the form editor, in a REAL browser (the real FormTab, bundled with rolldown, through the same small host the panel tests use): a follow-up is drawn
// INDENTED with a connector that links it to the question it depends on and the short line "Shown if «Yes»"; a follow-up of a follow-up indents again; on a phone the indent is smaller and the connector stays;
// deleting a question asks IN the page ("This also deletes 2 follow-up questions: …") and takes its follow-ups with it; moving a question moves them together; "Remove condition" turns a follow-up into
// an ordinary question. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cascadeDeleteSentence, dependencyDepth, dependentsOf, deleteFieldWithDependents, moveField, newField, shownIfLabel } from '@/lib/calls/form-builder';
import type { FormField } from '@/lib/calls/types';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-927');

/** "Applied before?" (Yes/No) → "Which one?" (shown if Yes) → "Why did it not go ahead?" (shown if "Which one?" is answered) ; then an ordinary question. */
function form(): FormField[] {
  const mother = { ...newField('yes_no', 1, 0), id: 'q-1', label: '6.4.2 Have you applied before to this entity?' };
  const yes = mother.options.find((o) => /yes/i.test(o.label))!;
  const follow = { ...newField('short_text', 1, 1), id: 'q-2', label: 'Which one?', condition: { fieldId: 'q-1', operator: 'equals' as const, value: yes.id } };
  const deeper = { ...newField('long_text', 1, 2), id: 'q-3', label: 'Why did it not go ahead?', condition: { fieldId: 'q-2', operator: 'is_answered' as const, value: null } };
  const plain = { ...newField('short_text', 1, 3), id: 'q-4', label: 'Name of the company' };
  return [mother, follow, deeper, plain];
}

describe('follow-up questions: the rules (pure)', () => {
  it('depth, dependents, the short line, the cascade sentence, delete together, move together', () => {
    const f = form();
    expect(f.map((x) => dependencyDepth(f, x.id))).toEqual([0, 1, 2, 0]);
    expect(dependentsOf(f, 'q-1').map((x) => x.id)).toEqual(['q-2', 'q-3']);
    expect(dependentsOf(f, 'q-4')).toEqual([]);
    expect(shownIfLabel(f[1], f)).toBe('Shown if «Yes»');
    expect(shownIfLabel(f[2], f)).toBe('Shown if answered');
    expect(shownIfLabel(f[0], f)).toBeNull();
    expect(cascadeDeleteSentence(f, 'q-1')).toBe('This also deletes 2 follow-up questions: «Which one?», «Why did it not go ahead?».');
    expect(cascadeDeleteSentence(f, 'q-2')).toBe('This also deletes 1 follow-up question: «Why did it not go ahead?».');
    expect(cascadeDeleteSentence(f, 'q-4')).toBeNull();
    expect(deleteFieldWithDependents(f, 'q-1').map((x) => x.id)).toEqual(['q-4']);
    expect(deleteFieldWithDependents(f, 'q-2').map((x) => x.id)).toEqual(['q-1', 'q-4']);
    // down one step: the mother hops over the next ordinary question and her follow-ups come along, in order
    expect(moveField(f, 'q-1', 1).fields.map((x) => x.id)).toEqual(['q-4', 'q-1', 'q-2', 'q-3']);
    // and back up
    const down = moveField(f, 'q-1', 1).fields;
    expect(moveField(down, 'q-1', 0).fields.map((x) => x.id)).toEqual(['q-1', 'q-2', 'q-3', 'q-4']);
    // a follow-up still cannot be put above its question
    expect(moveField(f, 'q-2', 0).refused).toContain('must stay before it');
    // a cycle or a missing controller never loops
    const orphan = [{ ...f[1], condition: { fieldId: 'gone', operator: 'is_answered' as const, value: null } }];
    expect(dependencyDepth(orphan, 'q-2')).toBe(0);
    expect(shownIfLabel(orphan[0], orphan)).toBeNull();
  });
});

describe.skipIf(!CHROME)('follow-up questions in the editor (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-up-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/form-panel-selection.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `follow-up-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  async function open(width: number, initial: FormField[] = form()) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 700 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate((f) => (window as unknown as { __start: (a: unknown) => void }).__start(f), initial);
    await page.waitForSelector('[data-testid="field-card"]');
    const ids = () => page.evaluate(() => (window as unknown as { __fields: { id: string }[] }).__fields.map((f) => f.id));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, ids, overflow };
  }
  /** The left edge of each card, and whether a connector (the elbow drawn by ::before) is there. */
  const geometry = (page: import('playwright').Page) => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="field-card"]')).map((li) => {
    const card = li.querySelector<HTMLElement>('[draggable]')!;
    const frame = li.querySelector<HTMLElement>('[data-testid="dependent"]');
    const before = frame ? getComputedStyle(frame, '::before') : null;
    return { left: Math.round(card.getBoundingClientRect().left), connector: !!before && parseFloat(before.borderLeftWidth) > 0 && parseFloat(before.borderBottomWidth) > 0, shownIf: card.innerText.includes('Shown if') };
  }));

  it('a follow-up is indented with a connector and "Shown if", a follow-up of a follow-up indents again; smaller on a phone, the connector stays; nothing is wider than the screen', async () => {
    const lefts: Record<number, number[]> = {};
    for (const width of [1280, 768, 375]) {
      const { page, errors, overflow } = await open(width);
      const g = await geometry(page);
      lefts[width] = g.map((x) => x.left);
      expect(g[0].left, `${width}`).toBe(g[3].left);                                  // ordinary questions line up
      expect(g[1].left, `${width}`).toBeGreaterThan(g[0].left);
      expect(g[2].left, `${width}`).toBeGreaterThan(g[1].left);                       // the indent adds up
      expect(g.map((x) => x.connector), `${width}`).toEqual([false, true, true, false]);
      expect(g.map((x) => x.shownIf), `${width}`).toEqual([false, true, true, false]);
      expect(await page.locator('[data-testid="field-card"]').nth(1).innerText()).toContain('Shown if «Yes»');
      expect(await overflow(), `${width}`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(SHOTS, `follow-up-editor-${width}.png`), fullPage: true });
      expect(errors).toEqual([]);
      await page.close();
    }
    expect(lefts[375][1] - lefts[375][0]).toBeLessThan(lefts[1280][1] - lefts[1280][0]);        // the indent is smaller on a phone
  }, 120_000);

  it('deleting the question asks IN the page about its follow-ups and takes them with it; "Keep them" keeps everything; a question without follow-ups is deleted at once', async () => {
    const { page, ids } = await open(1280);
    await page.locator('[data-testid="field-card"]').nth(0).click();
    await page.locator('[data-testid="delete-field"]').click();
    expect(await page.locator('[data-testid="delete-confirm-text"]').innerText()).toBe('This also deletes 2 follow-up questions: «Which one?», «Why did it not go ahead?».');
    await page.screenshot({ path: path.join(SHOTS, 'follow-up-delete-1280.png'), fullPage: true });
    await page.locator('[data-testid="delete-confirm-no"]').click();
    expect(await ids()).toEqual(['q-1', 'q-2', 'q-3', 'q-4']);
    await page.locator('[data-testid="delete-field"]').click();
    await page.locator('[data-testid="delete-confirm-yes"]').click();
    expect(await ids()).toEqual(['q-4']);
    await page.locator('[data-testid="field-card"]').nth(0).click();
    await page.locator('[data-testid="delete-field"]').click();                                        // no follow-ups: no question asked
    expect(await page.locator('[data-testid="delete-confirm"]').count()).toBe(0);
    expect(await ids()).toEqual([]);
    await page.close();
  }, 120_000);

  it('moving the question moves its follow-ups with it; "Remove condition" makes a follow-up an ordinary question again (its own follow-up stays one level in)', async () => {
    const { page, ids } = await open(1280);
    await page.locator('[data-testid="field-card"]').nth(0).getByRole('button', { name: 'Move down' }).click();
    expect(await ids()).toEqual(['q-4', 'q-1', 'q-2', 'q-3']);
    await page.locator('[data-testid="field-card"]').nth(1).getByRole('button', { name: 'Move up' }).click();
    expect(await ids()).toEqual(['q-1', 'q-2', 'q-3', 'q-4']);
    await page.locator('[data-testid="field-card"]').nth(1).click();
    await page.getByRole('button', { name: 'Remove condition' }).click();
    const g = await geometry(page);
    expect(g.map((x) => x.connector)).toEqual([false, false, true, false]);
    expect(g[1].left).toBe(g[0].left);
    expect(g[2].left).toBeGreaterThan(g[1].left);
    await page.close();
  }, 120_000);
});
