// Prompt 918 E.1 — the copy icon on every row of the promo tree. What it copies is the row's own four facts, in the order the row shows
// them, so a message pasted from it matches the screen; the button reports a copy that failed instead of ticking; and it sits on BOTH
// lists the page has (the table and the genealogy) without making the table row select itself.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { promoNodeLine, promoTreeDate } from '@/lib/promo-tree-copy';
import { CopyLineButton } from '@/components/backoffice/CopyLineButton';

const NODE = { orgName: 'zz-test-Caramel Biscuit', code: 'PIONEER-AB12', wave: 2, redeemedAt: '2026-10-14T10:00:00Z' };

describe('promoNodeLine — "org · code · wave · date"', () => {
  it('is the four things the row shows, in that order, with the page\'s own date format', () => {
    expect(promoNodeLine(NODE)).toBe('zz-test-Caramel Biscuit · PIONEER-AB12 · wave 2 · 14 Oct 2026');
    expect(promoNodeLine(NODE).endsWith(promoTreeDate(NODE.redeemedAt))).toBe(true);
  });
  it('wave 0 (a root) still says so', () => {
    expect(promoNodeLine({ ...NODE, wave: 0 })).toContain('wave 0');
  });
});

describe('CopyLineButton', () => {
  const html = renderToStaticMarkup(createElement(CopyLineButton, { text: promoNodeLine(NODE), label: NODE.orgName }));
  it('is a labelled button that starts idle and shows what it will copy', () => {
    expect(html).toContain('<button type="button"');
    expect(html).toContain('aria-label="Copy zz-test-Caramel Biscuit"');
    expect(html).toContain('data-copy-state="idle"');
    expect(html).toContain('title="Copy: zz-test-Caramel Biscuit · PIONEER-AB12 · wave 2 · 14 Oct 2026"');
    expect(html).toContain('<svg');
  });
});

describe('the promo tree page', () => {
  const src = readFileSync(path.resolve(__dirname, '../app/backoffice/promo-tree/page.tsx'), 'utf8');
  it('has the icon on every row of the table AND on every row of the genealogy', () => {
    expect(src.match(/<CopyLineButton text=\{promoNodeLine\(/g)).toHaveLength(2);
    expect(src).toContain("from '@/lib/promo-tree-copy'");
  });
  it('shows dates through the same function the copied line uses', () => {
    expect(src).toContain('promoTreeDate as fmtDate');
    expect(src).not.toContain("toLocaleDateString('en-GB'");
  });
  it('the button stops the click, so copying a row never selects it', () => {
    const button = readFileSync(path.resolve(__dirname, '../components/backoffice/CopyLineButton.tsx'), 'utf8');
    expect(button).toContain('e.stopPropagation()');
    expect(button).toContain('writeToClipboard');
  });
});
