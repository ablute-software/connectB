// Prompt AL759 §B — the preview that scales, rendered for real. The point of
// the redesign is what is NOT in the DOM: 50 rows must not produce 50 cards.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportPreview } from './ImportPreview';
import { buildPortfolioImportPlan, type PortfolioImportPlanItem } from '@/lib/portfolio-import';

function plan(rows: string[][], existing: { companyName: string; domain: string | null }[] = []) {
  return buildPortfolioImportPlan(rows, existing, undefined, { defaultStatus: 'current' }).items;
}

function plan50() {
  const rows: string[][] = [['company_name', 'ticket_eur']];
  for (let i = 1; i <= 48; i++) rows.push([`Co ${i}`, '1000']);
  rows.push(['Warn Co', '1.500']);
  rows.push(['', '5']);
  return plan(rows);
}

function render(items: PortfolioImportPlanItem[], over: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(ImportPreview, {
    items, destination: 'current', editingRow: null, busy: false,
    onImport: () => {}, onToggleInclude: () => {}, onImportAnyway: () => {}, onEditRow: () => {}, onSaveRowEdit: () => {},
    onAcceptSuggestion: () => {}, onBulk: () => {}, onDownloadErrors: () => {}, ...over,
  }));
}

const count = (html: string, needle: string) => (html.match(new RegExp(needle, 'g')) ?? []).length;
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

describe('ImportPreview with 50 rows — Prompt AL759 §B', () => {
  it('shows a summary and "Import 49 companies" (48 ready + 1 warning; the error row is not importable)', () => {
    const html = render(plan50());
    expect(html).toContain('data-testid="import-summary"');
    expect(text(html)).toContain('48 ready · 1 with warning · 1 error');
    expect(text(html)).toContain('Import 49 companies');
  });

  it('the DOM has at most 2 exception cards and a 5-row sample — not 50 rows', () => {
    const html = render(plan50());
    expect(count(html, 'data-testid="attention-card"')).toBe(2);
    expect(count(html, 'data-testid="import-sample-table"')).toBe(1);
    // The sample is the ONLY table; its rows are the 5 first valid ones.
    expect(count(html, 'data-testid="import-row"')).toBe(5);
    expect(html).not.toContain('data-testid="import-full-table"');
    for (const name of ['Co 1<', 'Co 5<']) expect(html).toContain(name);
    expect(html).not.toContain('Co 6<');
    expect(html).not.toContain('Co 48<');
  });

  it('ready rows have no card of their own and no per-row "read as" line', () => {
    const html = render(plan50());
    expect(html).not.toContain('Row 2</span>');
    expect(count(html, 'data-testid="read-as"')).toBeLessThanOrEqual(1);
  });

  it('"Show all 50 rows" is offered, and the 49 readable rows only exist once expanded', () => {
    const closed = render(plan50());
    expect(text(closed)).toContain('Show all 50 rows');
    const open = render(plan50(), { defaultShowAllRows: true });
    expect(count(open, 'data-testid="import-row"')).toBe(49);
    expect(open).toContain('data-testid="import-full-table"');
    expect(open).not.toContain('data-testid="import-sample-table"');
    expect(text(open)).toContain('Show sample only');
    // The expanded list carries a checkbox per row to untick.
    expect(count(open, 'aria-label="Include row ')).toBeGreaterThanOrEqual(49);
  });

  it('the sample uses the destination tab\'s own columns (Past adds Exit date / Exit type)', () => {
    const rows = [['company_name', 'exit_at', 'exit_type'], ['Old', '2023-09-01', 'acquisition']];
    const items = buildPortfolioImportPlan(rows, [], undefined, { defaultStatus: 'past' }).items;
    const past = render(items, { destination: 'past' });
    expect(text(past)).toContain('Exit date');
    expect(text(past)).toContain('1 Sep 2023');
    expect(text(past)).toContain('Acquisition');
    const current = render(plan([['company_name', 'country'], ['Old', 'PT']]), { destination: 'current' });
    expect(text(current)).not.toContain('Exit date');
  });

  it('keeps Download rows with errors only when there are errors, and the bulk toggles only when they apply', () => {
    expect(text(render(plan50()))).toContain('Download rows with errors');
    const clean = render(plan([['company_name', 'country'], ['A', 'PT'], ['B', 'PT']]));
    expect(text(clean)).not.toContain('Download rows with errors');
    expect(text(clean)).not.toContain('duplicates');
    expect(text(clean)).not.toContain('rows with warnings');
  });
});

describe('ImportPreview exceptions — Prompt AL759 §B', () => {
  it('with no problems it says "No problems found" and has no exception block at all', () => {
    const html = render(plan([['company_name', 'country'], ['A', 'PT'], ['B', 'PT'], ['C', 'PT']]));
    expect(text(html)).toContain('No problems found');
    expect(html).not.toContain('Needs your attention');
    expect(count(html, 'data-testid="attention-card"')).toBe(0);
  });

  it('with more than 10 exceptions it shows the first 10 and "Show all N"', () => {
    const rows: string[][] = [['company_name', 'ticket_eur']];
    for (let i = 0; i < 12; i++) rows.push(['', String(i + 1)]);
    const items = plan(rows);
    const html = render(items);
    expect(count(html, 'data-testid="attention-card"')).toBe(10);
    expect(text(html)).toContain('Show all 12');
    expect(count(render(items, { defaultShowAllAttention: true }), 'data-testid="attention-card"')).toBe(12);
  });

  it('a duplicate offers "Include all duplicates" (they start excluded) and "Import anyway" — a warning does not', () => {
    const items = plan([['company_name', 'ticket_eur'], ['Dup', '100'], ['Warn', '1.500']], [{ companyName: 'Dup', domain: null }]);
    const html = render(items);
    expect(text(html)).toContain('Include all duplicates');
    expect(count(html, '>Import anyway<')).toBe(1);
    expect(text(html)).toContain('Exclude rows with warnings');
  });

  it('an error card never offers "Import anyway", and its checkbox is disabled', () => {
    const html = render(plan([['company_name', 'ticket_eur'], ['', '5']]));
    expect(html).not.toContain('Import anyway');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
  });

  it('keeps the sector suggestion button on a warning card', () => {
    const items = plan([['company_name', 'sectors'], ['Acme', 'MedTec']]);
    expect(text(render(items))).toContain('Use “MedTech & Medical Devices”');
  });

  it('a human-ambiguous date keeps its "read as" line in the expanded list', () => {
    const items = plan([['company_name', 'invested_at'], ['Plain', '15/03/2022'], ['Amb', '03/04/2022']]);
    const open = render(items, { defaultShowAllRows: true });
    expect(count(open, 'data-testid="read-as"')).toBe(1);
    expect(text(open)).toContain('invested_at: "03/04/2022" → 3 Apr 2022');
  });
});
