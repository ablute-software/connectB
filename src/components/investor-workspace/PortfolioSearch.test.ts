// Prompt AL759 Adenda 1 §D.1 — the search box's ARIA combobox markup, rendered
// for real. The keyboard rules themselves (comboKeyAction) are tested in
// portfolio-view.test.ts; this proves the attributes a screen reader relies on.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SearchView, SEARCH_PLACEHOLDER, optionId } from './PortfolioSearch';
import { suggest, type PortfolioCompany } from '@/lib/portfolio-table';

let seq = 0;
function co(name: string, over: Partial<PortfolioCompany> = {}): PortfolioCompany {
  seq++;
  return {
    id: `id-${seq}`, status: 'current', company_name: name, website: null, domain: null, country: null, stage_at_entry: null,
    sectors: [], ticket_eur: null, instrument: null, invested_at: null, exit_at: null, exit_type: null, contact_name: null,
    contact_email: null, contact_phone: null, source: 'manual', created_at: '2026-09-10T10:00:00Z', ...over,
  };
}

const ROWS = [
  co('Portugal Dogs', { country: 'Spain' }),
  co('Alfa', { country: 'Portugal' }), co('Beta', { country: 'Portugal' }), co('Gamma', { country: 'Portugal' }),
  co('Delta', { country: 'Italy', contact_name: 'Ana Portugal' }),
];

function view(over: Record<string, unknown> = {}) {
  const text = (over.text as string) ?? 'portugal';
  return renderToStaticMarkup(createElement(SearchView, {
    listboxId: 'lb', text, open: true, activeIndex: -1, suggestions: suggest(ROWS, text), filter: null, hasCommittedText: false,
    onTextChange: () => {}, onKeyDown: () => {}, onFocus: () => {}, onChoose: () => {}, onHover: () => {},
    onClearFilter: () => {}, onClearText: () => {}, ...over,
  }));
}

describe('SearchView — ARIA combobox pattern', () => {
  it('is ONE small box with the agreed placeholder and a combobox role', () => {
    const html = view();
    expect((html.match(/<input/g) ?? [])).toHaveLength(1);
    expect(html).toContain(`placeholder="${SEARCH_PLACEHOLDER}"`);
    expect(SEARCH_PLACEHOLDER).toBe('Search company, sector, country or contact');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
  });

  it('open with suggestions: aria-expanded=true, aria-controls points at the listbox, options are role=option', () => {
    const html = view();
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="lb"');
    expect(html).toContain('id="lb"');
    expect(html).toContain('role="listbox"');
    expect((html.match(/role="option"/g) ?? []).length).toBe(3);
  });

  it('each group is a labelled role=group, in the order Company, Country, Contact', () => {
    const html = view();
    const groups = [...html.matchAll(/role="group" aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(groups).toEqual(['Company', 'Country', 'Contact']);
  });

  it('options read "Field · value (count)" with the typed text highlighted and no duplicate Portugal', () => {
    const html = view();
    expect(html).toContain('Country · ');
    expect(html).toContain('<mark');
    const text = html.replace(/<[^>]+>/g, '');
    expect(text).toContain('Company · Portugal Dogs');
    expect(text).toContain('Country · Portugal (3)');
    expect(text).toContain('Contact · Ana Portugal (1)');
    expect(text.match(/Country · Portugal/g)).toHaveLength(1);
  });

  it('aria-activedescendant names the highlighted option, and only that one is aria-selected', () => {
    const html = view({ activeIndex: 1 });
    expect(html).toContain(`aria-activedescendant="${optionId('lb', 1)}"`);
    expect(html).toContain(`id="${optionId('lb', 1)}" role="option" aria-selected="true"`);
    expect((html.match(/aria-selected="true"/g) ?? [])).toHaveLength(1);
    expect((html.match(/aria-selected="false"/g) ?? [])).toHaveLength(2);
  });

  it('with nothing highlighted there is no aria-activedescendant', () => {
    expect(view({ activeIndex: -1 })).not.toContain('aria-activedescendant');
  });

  it('closed: aria-expanded=false, no listbox, no activedescendant', () => {
    const html = view({ open: false, activeIndex: 0 });
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('aria-activedescendant');
  });

  it('open but nothing to suggest (under 2 characters): not expanded', () => {
    const html = view({ text: 'p' });
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
  });

  it('a chosen suggestion shows as a tag INSIDE the box with a clearing ×', () => {
    const html = view({ text: '', filter: { field: 'country', value: 'Portugal' } });
    expect(html).toContain('data-testid="filter-tag"');
    expect(html.replace(/<[^>]+>/g, '')).toContain('Country: Portugal×');
    expect(html).toContain('aria-label="Clear filter Country: Portugal"');
    // One box: the tag is rendered before the input, inside the same wrapper.
    expect(html.indexOf('filter-tag')).toBeLessThan(html.indexOf('<input'));
  });

  it('shows a clear-text × only when there is text to clear', () => {
    expect(view({ text: '' })).not.toContain('Clear search text');
    expect(view({ text: 'port' })).toContain('aria-label="Clear search text"');
    expect(view({ text: '', hasCommittedText: true })).toContain('aria-label="Clear search text"');
  });
});
