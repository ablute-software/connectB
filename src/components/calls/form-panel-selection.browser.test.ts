// Prompt 917 (27/10/2026) — the form editor's panel edits the question that is SELECTED, by its id, and nothing else. The bug: after "What is missing → go to this question" the editor kept a jump
// target, and the form tab re-selected it on EVERY change of the form — so selecting the 3rd question and typing moved the panel back to the jump's target (the first question) after the first
// character, and the rest of the text was written over THAT question. This bundles the real FormTab (rolldown) and drives it in a real browser: no jsdom, no dev server. Without a Chrome (set
// CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newField } from '@/lib/calls/form-builder';
import { newSubField } from '@/lib/calls/field-config';
import type { FormField } from '@/lib/calls/types';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));

function questions(): FormField[] {
  const q = (i: number, over: Partial<FormField> = {}): FormField => ({ ...newField('short_text', 1, i), id: `q-${i + 1}`, label: `Question ${i + 1}`, ...over });
  const group = newField('group', 1, 5);
  group.id = 'q-6'; group.label = 'Competitors';
  group.validations = { group: { ...group.validations.group!, subFields: [
    { ...newSubField('short_text'), id: 's-1', label: 'Sub one' }, { ...newSubField('short_text'), id: 's-2', label: 'Sub two' }, { ...newSubField('short_text'), id: 's-3', label: 'Sub three' },
  ] } };
  return [q(0), q(1), q(2), q(3), q(4), group];
}

describe.skipIf(!CHROME)('the panel edits the selected question by id (real browser)', () => {
  let bundle = '';
  let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    // A variable specifier: the compiler does not load rolldown's type definitions into every typecheck of the project.
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-selection-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/form-panel-selection.harness.tsx'),
      cwd: process.cwd(),
      platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' },
      logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `panel-selection-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8');
    fs.rmSync(cssOut, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); });

  async function open(initial: FormField[], jumpTo?: string) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(([f, j]) => (window as unknown as { __start: (a: unknown, b?: string) => void }).__start(f, j ?? undefined), [initial, jumpTo ?? null] as const);
    await page.waitForSelector('[data-testid="field-card"]');
    return { page, errors, labels: () => page.evaluate(() => (window as unknown as { __fields: { id: string; label: string }[] }).__fields.map((f) => `${f.id}=${f.label}`)) };
  }

  it('select the 3rd question, change its text: only the 3rd changes — also after a jump to the 1st ("What is missing")', async () => {
    for (const jumpTo of [undefined, 'q-1']) {
      const { page, errors, labels } = await open(questions(), jumpTo);
      await page.locator('[data-testid="field-card"]').nth(2).click();
      await page.locator('#fp-label').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('A completely new third question');           // key by key, as a person types: every key is a change of the form
      const after = await labels();
      expect(after[0], `jump=${jumpTo}`).toBe('q-1=Question 1');
      expect(after[1]).toBe('q-2=Question 2');
      expect(after[2]).toBe('q-3=A completely new third question');
      expect(after.slice(3, 5)).toEqual(['q-4=Question 4', 'q-5=Question 5']);
      expect(await page.locator('#fp-label').inputValue()).toBe('A completely new third question');
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 120_000);

  it('a jump still opens its question once, and selecting another afterwards sticks', async () => {
    const { page, labels } = await open(questions(), 'q-4');
    expect(await page.locator('#fp-label').inputValue()).toBe('Question 4');
    await page.locator('[data-testid="field-card"]').nth(1).click();
    expect(await page.locator('#fp-label').inputValue()).toBe('Question 2');
    await page.locator('#fp-label').click(); await page.keyboard.press('End'); await page.keyboard.type('!');
    expect(await page.locator('#fp-label').inputValue()).toBe('Question 2!');
    expect((await labels())[1]).toBe('q-2=Question 2!');
    await page.close();
  }, 120_000);

  it('a group\'s sub-question: editing the 2nd changes only the 2nd, whatever else was selected before', async () => {
    const { page, labels } = await open(questions(), 'q-1');
    await page.locator('[data-testid="field-card"]').nth(5).click();
    const subs = page.locator('[data-testid="subfield-label"]');
    await subs.nth(1).click(); await page.keyboard.press('Control+A'); await page.keyboard.type('Changed second sub-question');
    const group = await page.evaluate(() => (window as unknown as { __fields: { id: string; validations: { group: { subFields: { id: string; label: string }[] } } }[] }).__fields.find((f) => f.id === 'q-6')!.validations.group.subFields.map((s) => `${s.id}=${s.label}`));
    expect(group).toEqual(['s-1=Sub one', 's-2=Changed second sub-question', 's-3=Sub three']);
    expect((await labels()).slice(0, 5)).toEqual(['q-1=Question 1', 'q-2=Question 2', 'q-3=Question 3', 'q-4=Question 4', 'q-5=Question 5']);
    await page.close();
  }, 120_000);
});
