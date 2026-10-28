// Prompt 917 (Adenda 2, A) — the form editor's settings panel, drawn by a REAL browser at 1280, 1024, 768 and 375 px: nothing in it may be wider than the panel. The bug: in a repeatable group's
// "Questions in each entry" the text of the sub-question was squeezed into a 20 px square (the type select, `w-full` against `w-40`, took the row), and the ↑ ↓ ✕ buttons sat outside the card —
// so a question could not even be written. This renders the real panel (static markup of FieldPanel) with the real stylesheet (Tailwind, built from the components) into Chrome and fails when
// ANY element of the panel has scrollWidth > clientWidth or sits outside the panel's rectangle. It needs no dev server and no harness page. Without a Chrome (set CHROME_PATH) it is skipped.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newField } from '@/lib/calls/form-builder';
import { newSubField } from '@/lib/calls/field-config';
import type { FormField } from '@/lib/calls/types';
import { defaultTableConfig } from '@/lib/calls/table';
import { FieldPanel } from './FormTab';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const WIDTHS = [1280, 1024, 768, 375] as const;

const LONG = 'A very long answer option that goes on and on, with a_very_long_unbroken_word_that_cannot_wrap_anywhere_by_itself_1234567890 and then some more words after it';
function fixtures(): { name: string; field: FormField; ordered: FormField[] }[] {
  const lead = { ...newField('single_choice', 1, 0), label: 'Which of these long-winded programme categories describes your startup best, taking into account everything in the regulation?', options: [{ id: 'o1', label: 'Health' }, { id: 'o2', label: 'Industry' }] };
  const group = newField('group', 1, 1);
  group.label = 'Competitive analysis: tell us about every competitor you have identified in your market, one entry each';
  group.validations = { group: { ...group.validations.group!, entryLabel: 'Competitor', subFields: [
    { ...newSubField('short_text'), label: 'Name of the competitor and the country where it is based, as it appears in its public filings', required: true },
    { ...newSubField('single_choice'), label: 'How direct is the competition?', options: [{ id: 'a', label: 'Direct competitor in every market we operate in' }, { id: 'b', label: 'Indirect' }] },
    { ...newSubField('file'), label: 'Evidence (PDF)' },
  ] } };
  const choice = newField('single_choice', 1, 2);
  choice.label = 'Eight long options';
  choice.options = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, label: `${i + 1}. ${LONG}` }));
  const conditional = { ...newField('short_text', 1, 3), label: 'Tell us more', condition: { fieldId: lead.id, operator: 'equals' as const, value: 'o1' } };
  // Prompt 917 (Adenda 2, B1): the table's editor — long header names, a per-row type, the add rules and the preview — must fit the panel as well.
  const table = newField('table', 1, 4);
  table.label = 'Competitive analysis: tell us how you compare with every competitor you have identified in your market, criterion by criterion';
  table.validations = { table: { ...defaultTableConfig(), cornerTitle: 'Relevant criteria, as the entity names them in the regulation of the call',
    rows: [{ id: 'r_prod', label: 'Products & Services, with every product line described in one sentence and a link' }, { id: 'r_biz', label: 'Business Model' }, { id: 'r_share', label: 'Market Share (%) in each market ' + LONG }],
    columns: [{ id: 'c_you', label: 'Your solution/company' }, { id: 'c_1', label: 'Competitor #1 ' + LONG }, { id: 'c_2', label: 'Competitor #2' }],
    rowKinds: { r_share: 'percent' }, addColumns: { allowed: true, max: 6, defaultName: 'Competitor #' }, addRows: { allowed: true, max: 8, defaultName: 'Criterion #' }, required: 'all' } };
  const ordered = [lead, group, choice, conditional, table];
  return [
    { name: 'a group with three sub-questions of different types', field: group, ordered },
    { name: 'a choice with eight long options', field: choice, ordered },
    { name: 'a question with a condition on a long-titled question', field: conditional, ordered },
    { name: 'a table with long headers, a per-row type, add rules and its preview', field: table, ordered },
  ];
}

describe.skipIf(!CHROME)('the form editor\'s panel never goes past its own width (real browser)', () => {
  let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const out = path.join(os.tmpdir(), `panel-layout-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', out], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(out, 'utf8');
    fs.rmSync(out, { force: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 180_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  for (const width of WIDTHS) {
    it(`at ${width} px: no element has scrollWidth > clientWidth or sits outside the panel — for a group, a long choice and a condition`, async () => {
      // Wide: the panel is the 360 px column beside the questions. Narrower than 1024: it is a full screen (max-w-xl, 16 px of padding either side).
      const panelWidth = width >= 1024 ? 360 : Math.min(576, width - 32);
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const problems: string[] = [];
      for (const { name, field, ordered } of fixtures()) {
        const html = renderToStaticMarkup(createElement(FieldPanel, { field, ordered, disabled: false, onChange: () => {}, onReplace: () => {}, onDelete: () => {} }));
        await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="host" style="width:${panelWidth}px;margin:0 16px">${html}</div></body></html>`);
        const found = await page.evaluate(() => {
          const panel = document.querySelector('[data-field-panel]') as HTMLElement;
          const box = panel.getBoundingClientRect();
          const bad: string[] = [];
          for (const el of [panel, ...Array.from(panel.querySelectorAll<HTMLElement>('*'))]) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            const label = `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}.${String(el.className).slice(0, 40)}`;
            if (el.scrollWidth > el.clientWidth + 0.5 && getComputedStyle(el).display !== 'inline') bad.push(`scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}: ${label}`);
            if (r.left < box.left - 0.5 || r.right > box.right + 0.5) bad.push(`outside the panel (${Math.round(r.left - box.left)}…${Math.round(r.right - box.right)}): ${label}`);
          }
          const sub = panel.querySelector('[data-testid="subfield-label"]') as HTMLElement | null;
          return { bad, page: document.documentElement.scrollWidth - document.documentElement.clientWidth, panelWidth: Math.round(box.width), subWidth: sub ? Math.round(sub.getBoundingClientRect().width) : null };
        });
        // PANEL_SHOTS_DIR=… saves a picture of each panel (for the report); nothing is written otherwise.
        if (process.env.PANEL_SHOTS_DIR) { fs.mkdirSync(process.env.PANEL_SHOTS_DIR, { recursive: true }); await page.locator('#host').screenshot({ path: path.join(process.env.PANEL_SHOTS_DIR, `${width}-${name.split(' ').slice(0, 3).join('-')}.png`) }); }
        problems.push(...found.bad.map((b) => `[${name}] ${b}`));
        if (found.page > 0) problems.push(`[${name}] the page scrolls sideways by ${found.page}px`);
        if (found.subWidth !== null && found.subWidth < found.panelWidth * 0.7) problems.push(`[${name}] the sub-question's text box is only ${found.subWidth}px of a ${found.panelWidth}px panel`);
      }
      await page.close();
      expect(problems).toEqual([]);
    }, 120_000);
  }
});
