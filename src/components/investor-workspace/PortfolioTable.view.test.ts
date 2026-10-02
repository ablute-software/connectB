// Prompt AL759 — the table as an investor sees it: selection checkboxes,
// click-to-sort headers, the general-search highlight, and the empty-result
// body. Rendered for real with react-dom/server (see PortfolioTable.test.ts).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PortfolioTable } from './PortfolioTable';
import { arrangeCompanies, NO_SORT, type PortfolioCompany, type PortfolioTab, type SortState } from '@/lib/portfolio-table';

let seq = 0;
function co(name: string, over: Partial<PortfolioCompany> = {}): PortfolioCompany {
  seq++;
  return {
    id: `id-${seq}`, status: 'current', company_name: name, website: null, domain: null, country: null, stage_at_entry: null,
    sectors: [], ticket_eur: null, instrument: null, invested_at: null, exit_at: null, exit_type: null, contact_name: null,
    contact_email: null, contact_phone: null, source: 'manual',
    created_at: `2026-09-${String(10 + (seq % 18)).padStart(2, '0')}T10:00:${String(seq % 60).padStart(2, '0')}Z`, ...over,
  };
}

function render(tab: PortfolioTab, companies: PortfolioCompany[], extra: Record<string, unknown> = {}, page = 1) {
  return renderToStaticMarkup(createElement(PortfolioTable, {
    tab, companies, page, onPageChange: () => {}, onEdit: () => {}, onAskRemove: () => {},
    onConfirmRemove: () => {}, onCancelRemove: () => {}, ...extra,
  }));
}

const ths = (html: string) => [...html.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)].map((m) => ({ attrs: m[1], inner: m[2] }));
const rowsOf = (html: string) => [...html.matchAll(/<tr[^>]*data-testid="portfolio-row"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
const cellsOf = (row: string) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
const marks = (s: string) => (s.match(/<mark/g) ?? []).length;

const selection = (selectedIds: string[], pageSelection: 'none' | 'some' | 'all' = 'none') => ({
  selectedIds: new Set(selectedIds), pageSelection, onTogglePage: () => {}, onToggleOne: () => {},
});

describe('selection column — Prompt AL759 §C', () => {
  it('draws a checkbox per row with an accessible name, and "Select all on this page" in the header', () => {
    const a = co('Alfa'); const b = co('Beta');
    const html = render('current', [a, b], { selection: selection([b.id]) });
    expect(html).toContain('aria-label="Select all on this page"');
    expect(html).toContain('aria-label="Select Alfa"');
    expect(html).toContain('aria-label="Select Beta"');
    // Beta is selected, Alfa is not.
    const alfa = rowsOf(html).find((r) => r.includes('Select Alfa'))!;
    const beta = rowsOf(html).find((r) => r.includes('Select Beta'))!;
    expect(beta).toMatch(/checked/);
    expect(alfa).not.toMatch(/checked/);
  });

  it('the header checkbox is checked only when the whole page is', () => {
    const rows = [co('A'), co('B')];
    expect(ths(render('current', rows, { selection: selection([], 'none') }))[0].inner).not.toMatch(/checked/);
    expect(ths(render('current', rows, { selection: selection(rows.map((r) => r.id), 'all') }))[0].inner).toMatch(/checked/);
  });

  it('no selection prop -> no checkbox column at all (the AL758 table is unchanged)', () => {
    const html = render('current', [co('A')]);
    expect(html).not.toContain('type="checkbox"');
  });

  it('the empty-state row spans the extra column', () => {
    const withSel = render('current', [], { selection: selection([]) });
    const without = render('current', []);
    const span = (h: string) => Number(/<td colSpan="(\d+)"/.exec(h)![1]);
    expect(span(withSel)).toBe(span(without) + 1);
  });
});

describe('sortable headers — Prompt AL759 §D', () => {
  const sortable = (tab: PortfolioTab, sort?: SortState) => ths(render(tab, [co('A')], { onSort: () => {}, sort })).filter((t) => t.inner.includes('<button'));
  const label = (t: { inner: string }) => t.inner.replace(/<[^>]+>/g, '').replace(/[▲▼]/g, '').trim();

  it('Current: only Company, Geography, Ticket, Invested on and Contact are clickable', () => {
    expect(sortable('current').map(label)).toEqual(['Company', 'Geography', 'Ticket', 'Invested on', 'Contact']);
  });

  it('Past adds Exit date; Website, Stage, Sectors, Instrument and Exit type never are', () => {
    expect(sortable('past').map(label)).toEqual(['Company', 'Geography', 'Ticket', 'Invested on', 'Exit date', 'Contact']);
  });

  it('every sortable <th> carries aria-sort ("none" until sorted); the others carry none', () => {
    const all = ths(render('past', [co('A')], { onSort: () => {} }));
    for (const t of all) {
      const isSortable = t.inner.includes('<button');
      expect(/aria-sort=/.test(t.attrs)).toBe(isSortable);
      if (isSortable) expect(t.attrs).toContain('aria-sort="none"');
    }
  });

  it('only the ACTIVE column shows an arrow, and aria-sort says which way', () => {
    const asc = render('current', [co('A')], { onSort: () => {}, sort: { key: 'ticket', dir: 'asc' } });
    expect((asc.match(/[▲▼]/g) ?? [])).toEqual(['▲']);
    const ticketTh = ths(asc).find((t) => label(t) === 'Ticket')!;
    expect(ticketTh.attrs).toContain('aria-sort="ascending"');
    expect(ths(asc).find((t) => label(t) === 'Company')!.attrs).toContain('aria-sort="none"');

    const desc = render('current', [co('A')], { onSort: () => {}, sort: { key: 'ticket', dir: 'desc' } });
    expect((desc.match(/[▲▼]/g) ?? [])).toEqual(['▼']);
    expect(ths(desc).find((t) => label(t) === 'Ticket')!.attrs).toContain('aria-sort="descending"');
  });

  it('with the default order there is no arrow anywhere', () => {
    const html = render('current', [co('A')], { onSort: () => {}, sort: NO_SORT });
    expect(html).not.toMatch(/[▲▼]/);
  });

  it('without onSort the headers are plain text (AL758 unchanged)', () => {
    const html = render('past', [co('A')]);
    expect(html).not.toContain('aria-sort');
    expect(ths(html).some((t) => t.inner.includes('<button'))).toBe(false);
  });
});

describe('empty result and counter — Prompt AL759 §D', () => {
  it('0 results keeps the header and says what matched nothing, with a "Clear search" link', () => {
    const html = render('current', [], { noMatch: { text: 'No companies match "xyz".', onClear: () => {} } });
    expect(html).toContain('<thead');
    expect(html).toContain('No companies match &quot;xyz&quot;.');
    expect(html).toContain('>Clear search<');
    expect(html).not.toContain('companies yet');
  });

  it('shows "5 of 37 companies" when a search narrows the list, and plain "37 companies" otherwise', () => {
    const five = Array.from({ length: 5 }, (_, i) => co(`C${i}`));
    expect(render('current', five, { totalInTab: 37 })).toContain('5 of 37 companies');
    expect(render('current', five)).toContain('5 companies');
    expect(render('current', five, { totalInTab: 5 })).toContain('5 companies');
  });
});

describe('general-search highlight — Prompt AL759 Adenda 1 §D.3', () => {
  // The five rows that match "portugal" for five different reasons, in the
  // order the relevance sort puts them.
  const set = () => [
    co('Portugal Dogs', { country: 'Spain', sectors: ['PetTech'] }),
    co('Alfa Health', { country: 'Portugal' }),
    co('Beta Robotics', { country: 'Portugal' }),
    co('Gamma Pay', { country: 'Portugal' }),
    co('Delta Labs', { country: 'Italy', contact_name: 'Ana Portugal' }),
    co('Unrelated', { country: 'France', contact_name: 'Bob' }),
  ];
  // Column order: company 0, website 1, geography 2, stage 3, sectors 4, ticket 5, instrument 6, invested 7, contact 8.
  const COMPANY = 0; const GEOGRAPHY = 2; const CONTACT = 8;

  it('lights the text up ONLY in the cell where it matched — checked on all five rows', () => {
    const ordered = arrangeCompanies(set(), { q: 'portugal', filter: null }, NO_SORT);
    expect(ordered).toHaveLength(5);
    const html = render('current', ordered, { highlight: 'portugal' });
    const rows = rowsOf(html);
    expect(rows).toHaveLength(5);

    const expected: Record<string, number> = {
      'Portugal Dogs': COMPANY, 'Alfa Health': GEOGRAPHY, 'Beta Robotics': GEOGRAPHY, 'Gamma Pay': GEOGRAPHY, 'Delta Labs': CONTACT,
    };
    for (const row of rows) {
      const cells = cellsOf(row);
      const name = cells[COMPANY].replace(/<[^>]+>/g, '');
      const where = Object.entries(expected).find(([k]) => name.includes(k))![1];
      expect(marks(row)).toBe(1);
      expect(marks(cells[where])).toBe(1);
    }
  });

  it('shows the five in relevance order: the name match first, the contact match last', () => {
    const ordered = arrangeCompanies(set(), { q: 'portugal', filter: null }, NO_SORT);
    const html = render('current', ordered, { highlight: 'portugal' });
    const pos = (s: string) => html.indexOf(s);
    expect(pos('Dogs')).toBeLessThan(pos('Alfa Health'));
    expect(pos('Gamma Pay')).toBeLessThan(pos('Delta Labs'));
  });

  it('highlights nothing without a query, and never wraps the contact email', () => {
    const c = co('Acme', { contact_name: 'Ana', contact_email: 'portugal@acme.example' });
    expect(marks(render('current', [c]))).toBe(0);
    expect(marks(render('current', [c], { highlight: 'portugal' }))).toBe(0);
  });

  it('is accent-insensitive and keeps the displayed text as written', () => {
    const html = render('current', [co('Acme', { country: 'España' })], { highlight: 'espana' });
    expect(html).toContain('<mark');
    expect(html).toContain('>España<');
  });
});
