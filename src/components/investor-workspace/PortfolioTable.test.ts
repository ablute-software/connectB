// Prompt AL758 — renders the REAL PortfolioTable component (react-dom/server,
// no DOM needed) and asserts on the markup. This repo has no component-test
// library, and PortfolioTable is deliberately presentational (no router, no
// fetching) so it can be drawn from plain props. Written as .ts with
// createElement so no JSX is needed in the test file itself.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PortfolioTable } from './PortfolioTable';
import type { PortfolioCompany, PortfolioTab } from '@/lib/portfolio-table';

function company(i: number, status: PortfolioTab, over: Partial<PortfolioCompany> = {}): PortfolioCompany {
  return {
    id: `id-${i}`, status, company_name: `Company ${i}`, website: `https://company${i}.example`, domain: `company${i}.example`,
    country: 'Portugal', stage_at_entry: 'seed', sectors: ['Digital Health'], ticket_eur: 350000, instrument: 'convertible_note',
    invested_at: '2022-03-15', exit_at: status === 'past' ? '2024-09-01' : null, exit_type: status === 'past' ? 'acquisition' : null,
    contact_name: 'Jane Doe', contact_email: 'jane@x.example', contact_phone: '+351 912345678',
    source: 'manual', created_at: '2026-10-01T10:00:00Z', ...over,
  };
}

function render(tab: PortfolioTab, companies: PortfolioCompany[], page = 1, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(PortfolioTable, {
    tab, companies, page, onPageChange: () => {}, onEdit: () => {}, onAskRemove: () => {},
    onConfirmRemove: () => {}, onCancelRemove: () => {}, ...extra,
  }));
}

const th = (html: string) => [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]).filter(Boolean);
const rows = (html: string) => (html.match(/data-testid="portfolio-row"/g) ?? []).length;

const CURRENT_HEADERS = ['Company', 'Website', 'Geography', 'Stage at entry', 'Sectors', 'Ticket', 'Instrument', 'Invested on', 'Contact'];
const PAST_HEADERS = ['Company', 'Website', 'Geography', 'Stage at entry', 'Sectors', 'Ticket', 'Instrument', 'Invested on', 'Exit date', 'Exit type', 'Contact'];

describe('PortfolioTable — header always visible (Prompt AL758 §A)', () => {
  for (const tab of ['current', 'past'] as const) {
    const expected = tab === 'past' ? PAST_HEADERS : CURRENT_HEADERS;

    it(`${tab}: the full header is drawn with 0 rows, with the empty-state line UNDER it`, () => {
      const html = render(tab, []);
      expect(th(html)).toEqual(expected);
      expect(rows(html)).toBe(0);
      expect(html).toContain(`No ${tab} companies yet. Add one manually, or import a CSV/Excel using the template.`);
      // The empty state sits in the table body, not instead of the table.
      expect(html.indexOf('<thead')).toBeLessThan(html.indexOf('No ' + tab + ' companies yet'));
    });

    it(`${tab}: the full header with 1 row`, () => {
      const html = render(tab, [company(1, tab)]);
      expect(th(html)).toEqual(expected);
      expect(rows(html)).toBe(1);
      expect(html).not.toContain('companies yet');
    });

    it(`${tab}: the full header with 21 rows — 20 on page 1, 1 on page 2`, () => {
      const all = Array.from({ length: 21 }, (_, i) => company(i + 1, tab));
      const p1 = render(tab, all, 1);
      expect(th(p1)).toEqual(expected);
      expect(rows(p1)).toBe(20);
      expect(p1).toContain('Page 1 of 2');
      expect(p1).toContain('21 companies');
      const p2 = render(tab, all, 2);
      expect(th(p2)).toEqual(expected);
      expect(rows(p2)).toBe(1);
      expect(p2).toContain('Page 2 of 2');
      expect(p2).toContain('Company 21');
    });
  }

  it('Past has Exit date and Exit type as separate columns; Current has neither', () => {
    expect(th(render('past', []))).toEqual(expect.arrayContaining(['Exit date', 'Exit type']));
    const current = th(render('current', []));
    expect(current).not.toContain('Exit date');
    expect(current).not.toContain('Exit type');
    expect(current).not.toContain('Exit');
  });
});

describe('PortfolioTable — cells and pager (Prompt AL758 §A/§B)', () => {
  it('shows invested/exit dates spelled out, investment type and exit type as labels, blanks as a dash', () => {
    const html = render('past', [company(1, 'past'), company(2, 'past', {
      invested_at: null, exit_at: null, exit_type: null, instrument: null, contact_name: null, contact_email: null, contact_phone: null,
    })]);
    expect(html).toContain('15 Mar 2022');
    expect(html).toContain('1 Sep 2024');
    expect(html).toContain('Convertible note');
    expect(html).toContain('Acquisition');
    expect(html).toContain('Jane Doe · jane@x.example · +351 912345678');
    // The second row's blank cells render as an em dash, not as empty cells.
    expect((html.match(/>—</g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('keeps Invite (coming soon), Edit and Remove on every row', () => {
    const html = render('current', [company(1, 'current')]);
    expect(html).toContain('Invite to Sherlock Deal');
    expect(html).toContain('(Coming soon)');
    expect(html).toContain('>Edit<');
    expect(html).toContain('>Remove<');
  });

  it('Remove asks first when armed', () => {
    const html = render('current', [company(1, 'current')], 1, { confirmRemoveId: 'id-1' });
    expect(html).toContain('Remove Company 1?');
    expect(html).toContain('>Yes<');
    expect(html).toContain('>No<');
  });

  it('shows a total but no page controls when everything fits on one page', () => {
    const html = render('current', [company(1, 'current'), company(2, 'current')]);
    expect(html).toContain('2 companies');
    expect(html).not.toContain('Previous');
    expect(html).not.toContain('Page 1 of');
  });

  it('says "1 company" in the singular', () => {
    expect(render('current', [company(1, 'current')])).toContain('1 company');
  });

  it('a page past the end shows the last real page, not an empty table', () => {
    const all = Array.from({ length: 45 }, (_, i) => company(i + 1, 'current'));
    const html = render('current', all, 9);
    expect(rows(html)).toBe(5);
    expect(html).toContain('Page 3 of 3');
  });

  it('draws the header (not a data row) while loading', () => {
    const html = render('current', [], 1, { loading: true });
    expect(th(html)).toEqual(CURRENT_HEADERS);
    expect(html).toContain('Loading…');
    expect(html).not.toContain('companies yet');
  });
});
