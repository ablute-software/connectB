// Prompt AL759 (+ Adenda 1) — search with per-field suggestions, sort,
// selection and move, all as pure functions over the rows in memory.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_LIST_STATE, MOVE_BATCH_SIZE, NO_SORT, arrangeCompanies, chunkIds, comboKeyAction, filterCompanies, highlightParts,
  listAfter, matchesFilter, moveButtonLabel, moveConfirmation, moveTarget, nextSort, noMatchText, normalizeText,
  pageSelection, pageSlice, parseFilterParam, parseListParams, pruneSelection, relevanceRank, selectAllPrompt,
  showSuggestionCount, sortCompanies, sortKeysFor, suggest, summarizeMoveResults, toggleOne, togglePageSelection,
  validateMoveBody, writeListParams, SUGGESTIONS_TOTAL, type PortfolioCompany,
} from './portfolio-table';

let seq = 0;
/** created_at ascends with n, so "newest first" means higher n first. */
function co(name: string, over: Partial<PortfolioCompany> = {}): PortfolioCompany {
  seq++;
  return {
    id: `id-${name}-${seq}`, status: 'current', company_name: name, website: null, domain: null, country: null,
    stage_at_entry: null, sectors: [], ticket_eur: null, instrument: null, invested_at: null, exit_at: null, exit_type: null,
    contact_name: null, contact_email: null, contact_phone: null, source: 'manual',
    created_at: `2026-09-${String(10 + (seq % 18)).padStart(2, '0')}T10:00:${String(seq % 60).padStart(2, '0')}Z`, ...over,
  };
}
const names = (rows: PortfolioCompany[]) => rows.map((r) => r.company_name);

// The example from Nuno's request: five rows that match "portugal" for five
// different reasons.
function portugalSet(): PortfolioCompany[] {
  return [
    co('Portugal Dogs', { country: 'Spain', sectors: ['PetTech'] }),
    co('Alfa Health', { country: 'Portugal', sectors: ['Digital Health'] }),
    co('Beta Robotics', { country: 'Portugal', sectors: ['Robotics & Automation', 'Digital Health'] }),
    co('Gamma Pay', { country: 'Portugal', sectors: ['FinTech & InsurTech'] }),
    co('Delta Labs', { country: 'Italy', contact_name: 'Ana Portugal', sectors: ['Digital Health'] }),
    co('Unrelated Co', { country: 'France', contact_name: 'Bob Stone' }),
  ];
}

describe('suggestions — Prompt AL759 Adenda 1 §D.1', () => {
  it('"portugal" suggests each field once, grouped, with a count and no duplicate Portugal', () => {
    const s = suggest(portugalSet(), 'portugal');
    expect(s.map((x) => `${x.field}:${x.value}:${x.count}`)).toEqual([
      'company:Portugal Dogs:1',
      'country:Portugal:3',
      'contact:Ana Portugal:1',
    ]);
    expect(s.filter((x) => x.value === 'Portugal')).toHaveLength(1);
  });

  it('the groups come in the order Company, Country, Sector, Contact', () => {
    const rows = [
      co('Health Hub', { country: 'Healthland', sectors: ['Digital Health'], contact_name: 'Health Nut' }),
    ];
    expect(suggest(rows, 'health').map((x) => x.field)).toEqual(['company', 'country', 'sector', 'contact']);
  });

  it('only shows a count for a Company that appears more than once', () => {
    const [dogs] = suggest(portugalSet(), 'dogs');
    expect(showSuggestionCount(dogs)).toBe(false);
    const twice = suggest([co('Twin'), co('Twin')], 'twin')[0];
    expect(twice.count).toBe(2);
    expect(showSuggestionCount(twice)).toBe(true);
  });

  it('starts at 2 characters', () => {
    expect(suggest(portugalSet(), 'p')).toEqual([]);
    expect(suggest(portugalSet(), ' p ')).toEqual([]);
    expect(suggest(portugalSet(), 'po').length).toBeGreaterThan(0);
  });

  it('at most 3 per group and 8 in all', () => {
    const many = Array.from({ length: 6 }, (_, i) => co(`Acme ${i}`, { country: `Acmeland ${i}`, sectors: [`Acme Sector ${i}`], contact_name: `Acme Person ${i}` }));
    const s = suggest(many, 'acme');
    expect(s).toHaveLength(SUGGESTIONS_TOTAL);
    for (const field of ['company', 'country', 'sector', 'contact'] as const) {
      expect(s.filter((x) => x.field === field).length).toBeLessThanOrEqual(3);
    }
    // Company and Country fill their 3; Sector fills 2 of the remaining 2 slots; Contact is cut by the total.
    expect(s.map((x) => x.field)).toEqual(['company', 'company', 'company', 'country', 'country', 'country', 'sector', 'sector']);
  });

  it('merges a sector shared by several companies into one suggestion with a count', () => {
    const s = suggest(portugalSet(), 'digital');
    expect(s).toEqual([{ id: 'sector:digital health', field: 'sector', value: 'Digital Health', count: 3 }]);
  });

  it('ignores accents and case: "joao" suggests "João Silva", "ESPANA" finds "España"', () => {
    const rows = [co('Acme', { contact_name: 'João Silva', country: 'España' })];
    expect(suggest(rows, 'joao').map((x) => x.value)).toEqual(['João Silva']);
    expect(suggest(rows, 'ESPANA').map((x) => x.value)).toEqual(['España']);
  });

  it('a group with nothing to suggest does not appear', () => {
    expect(suggest(portugalSet(), 'stone').map((x) => x.field)).toEqual(['contact']);
  });
});

describe('tagged filter — Prompt AL759 Adenda 1 §D.2', () => {
  it('Country: Portugal is exactly the three HQ in Portugal — not Portugal Dogs, not the Ana Portugal contact', () => {
    const out = filterCompanies(portugalSet(), { q: '', filter: { field: 'country', value: 'Portugal' } });
    expect(names(out).sort()).toEqual(['Alfa Health', 'Beta Robotics', 'Gamma Pay']);
  });

  it('matches by equality, not substring, and ignores accents/case', () => {
    const rows = [co('A', { country: 'España' }), co('B', { country: 'España del Norte' })];
    expect(names(filterCompanies(rows, { q: '', filter: { field: 'country', value: 'espana' } }))).toEqual(['A']);
  });

  it('Company and Contact filter by the exact value', () => {
    expect(names(filterCompanies(portugalSet(), { q: '', filter: { field: 'company', value: 'Portugal Dogs' } }))).toEqual(['Portugal Dogs']);
    expect(names(filterCompanies(portugalSet(), { q: '', filter: { field: 'contact', value: 'Ana Portugal' } }))).toEqual(['Delta Labs']);
  });

  it('Sector matches companies that CONTAIN the sector (they have several)', () => {
    const out = filterCompanies(portugalSet(), { q: '', filter: { field: 'sector', value: 'Digital Health' } });
    expect(names(out).sort()).toEqual(['Alfa Health', 'Beta Robotics', 'Delta Labs']);
    expect(matchesFilter(portugalSet()[2], { field: 'sector', value: 'robotics & automation' })).toBe(true);
  });

  it('combines with free text beside it: Country: Portugal + "dogs" -> nothing (Portugal Dogs is HQ in Spain)', () => {
    expect(filterCompanies(portugalSet(), { q: 'dogs', filter: { field: 'country', value: 'Portugal' } })).toEqual([]);
    const inPortugal = [co('Portugal Dogs', { country: 'Portugal' })];
    expect(names(filterCompanies(inPortugal, { q: 'dogs', filter: { field: 'country', value: 'Portugal' } }))).toEqual(['Portugal Dogs']);
  });
});

describe('general search + relevance — Prompt AL759 Adenda 1 §D.3', () => {
  it('Enter with "portugal" finds all five, ordered name, country (newest first), then contact', () => {
    const rows = portugalSet();
    const out = arrangeCompanies(rows, { q: 'portugal', filter: null }, NO_SORT);
    expect(out).toHaveLength(5);
    expect(out[0].company_name).toBe('Portugal Dogs');
    expect(out[4].company_name).toBe('Delta Labs');
    const middle = out.slice(1, 4);
    expect(names(middle).sort()).toEqual(['Alfa Health', 'Beta Robotics', 'Gamma Pay']);
    // Inside the country group: created_at desc.
    const created = middle.map((c) => c.created_at);
    expect([...created].sort().reverse()).toEqual(created);
  });

  it('ranks by where the text first matched: name 0, country 1, sector 2, contact 3', () => {
    const rows = [
      co('Portugal Dogs', { country: 'Spain' }),
      co('Alfa', { country: 'Portugal' }),
      co('Beta', { country: 'X', sectors: ['Portugal Tech'] }),
      co('Gamma', { country: 'Y', contact_name: 'Ana Portugal' }),
      co('Zeta', { country: 'Z' }),
    ];
    expect(rows.map((r) => relevanceRank(r, 'portugal'))).toEqual([0, 1, 2, 3, null]);
  });

  it('with a column sort active, relevance does NOT apply — the investor\'s sort wins', () => {
    const rows = [
      co('Portugal Dogs', { country: 'Spain', ticket_eur: 100 }),
      co('Alfa', { country: 'Portugal', ticket_eur: 50 }),
    ];
    const bySort = arrangeCompanies(rows, { q: 'portugal', filter: null }, { key: 'ticket', dir: 'asc' });
    expect(names(bySort)).toEqual(['Alfa', 'Portugal Dogs']);
    const byRelevance = arrangeCompanies(rows, { q: 'portugal', filter: null }, NO_SORT);
    expect(names(byRelevance)).toEqual(['Portugal Dogs', 'Alfa']);
  });

  it('searches name, sectors, country and contact name, ignoring accents and case', () => {
    const rows = [co('Acme', { country: 'España' }), co('Zed', { contact_name: 'João Silva' }), co('Sec', { sectors: ['Digital Health'] })];
    expect(names(filterCompanies(rows, { q: 'ESPANA', filter: null }))).toEqual(['Acme']);
    expect(names(filterCompanies(rows, { q: 'joao', filter: null }))).toEqual(['Zed']);
    expect(names(filterCompanies(rows, { q: 'health', filter: null }))).toEqual(['Sec']);
  });

  it('says what matched nothing, naming the text and the tag', () => {
    expect(noMatchText({ q: 'xyz', filter: null })).toBe('No companies match "xyz".');
    expect(noMatchText({ q: 'dogs', filter: { field: 'country', value: 'Portugal' } })).toBe('No companies match "dogs" + Country: Portugal.');
    expect(noMatchText({ q: '', filter: { field: 'sector', value: 'EdTech' } })).toBe('No companies match Sector: EdTech.');
  });
});

describe('highlightParts', () => {
  it('wraps the searched text only where it occurs, keeping the original characters', () => {
    expect(highlightParts('Portugal Dogs', 'portugal')).toEqual([{ text: 'Portugal', match: true }, { text: ' Dogs', match: false }]);
    expect(highlightParts('Ana Portugal', 'portugal')).toEqual([{ text: 'Ana ', match: false }, { text: 'Portugal', match: true }]);
    expect(highlightParts('Spain', 'portugal')).toEqual([{ text: 'Spain', match: false }]);
  });

  it('ignores accents and case without altering what is shown', () => {
    expect(highlightParts('España', 'espana')).toEqual([{ text: 'España', match: true }]);
    expect(highlightParts('João Silva', 'JOAO')).toEqual([{ text: 'João', match: true }, { text: ' Silva', match: false }]);
  });

  it('marks every occurrence and handles no query', () => {
    expect(highlightParts('banana', 'an').filter((p) => p.match)).toHaveLength(2);
    expect(highlightParts('Acme', '')).toEqual([{ text: 'Acme', match: false }]);
    expect(highlightParts(null, 'x')).toEqual([{ text: '', match: false }]);
  });
});

describe('sort — Prompt AL759 §D', () => {
  it('Exit date is sortable only in Past; Website, Stage, Sectors, Instrument and Exit type never are', () => {
    expect(sortKeysFor('current')).toEqual(['company', 'geography', 'ticket', 'invested_on', 'contact']);
    expect(sortKeysFor('past')).toEqual(['company', 'geography', 'ticket', 'invested_on', 'exit_date', 'contact']);
  });

  it('a click cycles ascending -> descending -> default, and another column starts ascending', () => {
    let s = NO_SORT;
    s = nextSort(s, 'ticket'); expect(s).toEqual({ key: 'ticket', dir: 'asc' });
    s = nextSort(s, 'ticket'); expect(s).toEqual({ key: 'ticket', dir: 'desc' });
    s = nextSort(s, 'ticket'); expect(s).toEqual(NO_SORT);
    s = nextSort({ key: 'ticket', dir: 'desc' }, 'company'); expect(s).toEqual({ key: 'company', dir: 'asc' });
  });

  it('tickets sort by number, not text: 9.000 before 10.000', () => {
    const rows = [co('A', { ticket_eur: 10000 }), co('B', { ticket_eur: 9000 }), co('C', { ticket_eur: 100000 })];
    expect(names(sortCompanies(rows, { key: 'ticket', dir: 'asc' }))).toEqual(['B', 'A', 'C']);
    expect(names(sortCompanies(rows, { key: 'ticket', dir: 'desc' }))).toEqual(['C', 'A', 'B']);
  });

  it('dates sort by ISO value, not by formatted text', () => {
    const rows = [co('A', { invested_at: '2022-12-01' }), co('B', { invested_at: '2023-01-15' }), co('C', { invested_at: '2021-06-30' })];
    expect(names(sortCompanies(rows, { key: 'invested_on', dir: 'asc' }))).toEqual(['C', 'A', 'B']);
    const past = [co('X', { exit_at: '2024-02-01' }), co('Y', { exit_at: '2023-11-01' })];
    expect(names(sortCompanies(past, { key: 'exit_date', dir: 'asc' }))).toEqual(['Y', 'X']);
  });

  it('empty values go LAST in both directions — a company with no ticket never heads a ticket sort', () => {
    const rows = [co('None'), co('Low', { ticket_eur: 1 }), co('High', { ticket_eur: 9 })];
    expect(names(sortCompanies(rows, { key: 'ticket', dir: 'asc' }))).toEqual(['Low', 'High', 'None']);
    expect(names(sortCompanies(rows, { key: 'ticket', dir: 'desc' }))).toEqual(['High', 'Low', 'None']);
    const dates = [co('NoDate'), co('D', { invested_at: '2020-01-01' })];
    expect(names(sortCompanies(dates, { key: 'invested_on', dir: 'desc' }))).toEqual(['D', 'NoDate']);
    const texts = [co('NoGeo'), co('Geo', { country: 'Spain' })];
    expect(names(sortCompanies(texts, { key: 'geography', dir: 'asc' }))).toEqual(['Geo', 'NoGeo']);
    expect(names(sortCompanies(texts, { key: 'geography', dir: 'desc' }))).toEqual(['Geo', 'NoGeo']);
  });

  it('text sorts by its accent-less form: "Álvaro" is filed as "alvaro", before "Ana"', () => {
    const rows = [co('Bruno'), co('Ana'), co('Álvaro'), co('Aaron')];
    expect(names(sortCompanies(rows, { key: 'company', dir: 'asc' }))).toEqual(['Aaron', 'Álvaro', 'Ana', 'Bruno']);
  });

  it('contact sorts by the contact NAME, empties last', () => {
    const rows = [co('A', { contact_name: 'Zoe' }), co('B'), co('C', { contact_name: 'Ana' })];
    expect(names(sortCompanies(rows, { key: 'contact', dir: 'asc' }))).toEqual(['C', 'A', 'B']);
  });

  it('ties fall back to newest first, so the order is stable', () => {
    const a = co('A', { country: 'Spain', created_at: '2026-09-01T00:00:00Z' });
    const b = co('B', { country: 'Spain', created_at: '2026-09-02T00:00:00Z' });
    expect(names(sortCompanies([a, b], { key: 'geography', dir: 'asc' }))).toEqual(['B', 'A']);
    expect(names(sortCompanies([a, b], { key: 'geography', dir: 'desc' }))).toEqual(['B', 'A']);
  });

  it('orders the WHOLE filtered set and only then pages: page 1 of 45 holds the 20 smallest tickets overall', () => {
    const rows = Array.from({ length: 45 }, (_, i) => co(`C${i}`, { ticket_eur: (i * 7919) % 1000 + 1 }));
    const ordered = arrangeCompanies(rows, { q: '', filter: null }, { key: 'ticket', dir: 'asc' });
    const page1 = pageSlice(ordered, 1);
    const allTickets = rows.map((r) => r.ticket_eur as number).sort((a, b) => a - b);
    expect(page1.map((r) => r.ticket_eur)).toEqual(allTickets.slice(0, 20));
    expect(pageSlice(ordered, 3).map((r) => r.ticket_eur)).toEqual(allTickets.slice(40));
  });

  it('the default order is newest first', () => {
    const rows = [co('Old', { created_at: '2026-01-01T00:00:00Z' }), co('New', { created_at: '2026-09-01T00:00:00Z' })];
    expect(names(arrangeCompanies(rows, { q: '', filter: null }, NO_SORT))).toEqual(['New', 'Old']);
  });
});

describe('URL state — ?q= ?f= ?sort= ?dir= (Prompt AL759 §D, Adenda §4)', () => {
  it('round-trips text, tagged filter and sort', () => {
    const params = new URLSearchParams('view=past&page=2');
    writeListParams(params, { query: { q: 'ana silva', filter: { field: 'country', value: 'España' } }, sort: { key: 'ticket', dir: 'desc' } });
    expect(params.get('q')).toBe('ana silva');
    expect(params.get('f')).toBe('country:España');
    expect(params.get('sort')).toBe('ticket');
    expect(params.get('dir')).toBe('desc');
    // Existing params (the tab, the page) are left alone.
    expect(params.get('view')).toBe('past');
    const back = parseListParams(new URLSearchParams(params.toString()), 'past');
    expect(back).toEqual({ query: { q: 'ana silva', filter: { field: 'country', value: 'España' } }, sort: { key: 'ticket', dir: 'desc' } });
  });

  it('values are URL-encoded and survive special characters', () => {
    const params = new URLSearchParams();
    writeListParams(params, { query: { q: 'a&b=c', filter: { field: 'company', value: 'R&D: Labs' } }, sort: NO_SORT });
    const back = parseListParams(new URLSearchParams(params.toString()), 'current');
    expect(back.query).toEqual({ q: 'a&b=c', filter: { field: 'company', value: 'R&D: Labs' } });
  });

  it('defaults stay out of the URL', () => {
    const params = new URLSearchParams('q=x&f=country:Spain&sort=ticket&dir=desc');
    writeListParams(params, EMPTY_LIST_STATE);
    expect(params.toString()).toBe('');
  });

  it('an unknown filter field, a missing colon or an empty value is IGNORED, never an error', () => {
    expect(parseFilterParam('planet:Mars')).toBeNull();
    expect(parseFilterParam('country')).toBeNull();
    expect(parseFilterParam('country:')).toBeNull();
    expect(parseFilterParam(':Spain')).toBeNull();
    expect(parseFilterParam(null)).toBeNull();
    expect(parseListParams(new URLSearchParams('f=planet:Mars'), 'current').query.filter).toBeNull();
    expect(parseFilterParam('sector:EdTech')).toEqual({ field: 'sector', value: 'EdTech' });
  });

  it('an unknown sort key, or exit_date on Current, is ignored', () => {
    expect(parseListParams(new URLSearchParams('sort=banana&dir=desc'), 'current').sort).toEqual(NO_SORT);
    expect(parseListParams(new URLSearchParams('sort=exit_date'), 'current').sort).toEqual(NO_SORT);
    expect(parseListParams(new URLSearchParams('sort=exit_date'), 'past').sort).toEqual({ key: 'exit_date', dir: 'asc' });
  });

  it('switching tab clears search, filter and sort; add/import reset them; edit/remove keep them', () => {
    const active = { query: { q: 'x', filter: { field: 'country' as const, value: 'Spain' } }, sort: { key: 'ticket' as const, dir: 'asc' as const } };
    expect(listAfter(active, 'switch-tab')).toEqual(EMPTY_LIST_STATE);
    expect(listAfter(active, 'added')).toEqual(EMPTY_LIST_STATE);
    expect(listAfter(active, 'imported')).toEqual(EMPTY_LIST_STATE);
    expect(listAfter(active, 'edited')).toBe(active);
    expect(listAfter(active, 'removed')).toBe(active);
  });
});

describe('selection — Prompt AL759 §C + Adenda §C', () => {
  const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `r${from + i}`);

  it('the header checkbox selects the visible page, and unselects it when it is already all selected', () => {
    const page = ids(20);
    let sel = togglePageSelection(new Set(), page);
    expect(pageSelection(sel, page)).toBe('all');
    expect(sel.size).toBe(20);
    sel = togglePageSelection(sel, page);
    expect(sel.size).toBe(0);
  });

  it('a partially selected page reads "some", and the header checkbox then completes it', () => {
    const page = ids(5);
    const sel = toggleOne(new Set(), 'r2');
    expect(pageSelection(sel, page)).toBe('some');
    expect(pageSelection(togglePageSelection(sel, page), page)).toBe('all');
  });

  it('with ONE page, selecting the page selects everything — no extra prompt', () => {
    const all = ids(12);
    const sel = togglePageSelection(new Set(), all);
    expect(sel.size).toBe(12);
    expect(selectAllPrompt(sel, all, all)).toBeNull();
  });

  it('with several pages: "20 selected on this page · Select all 37 matching", then "All 37 selected"', () => {
    const matching = ids(37);
    const page = matching.slice(0, 20);
    const sel = togglePageSelection(new Set(), page);
    expect(selectAllPrompt(sel, page, matching)).toEqual({ kind: 'select-all', onPage: 20, total: 37 });
    expect(selectAllPrompt(new Set(matching), page, matching)).toEqual({ kind: 'all-selected', total: 37 });
    // Nothing selected, or only part of the page: no prompt.
    expect(selectAllPrompt(new Set(), page, matching)).toBeNull();
    expect(selectAllPrompt(new Set(['r1']), page, matching)).toBeNull();
  });

  it('"Select all N matching" with a tagged filter active selects only the rows that pass it', () => {
    const rows = Array.from({ length: 30 }, (_, i) => co(`C${i}`, { country: i < 24 ? 'Portugal' : 'Spain' }));
    const matching = filterCompanies(rows, { q: '', filter: { field: 'country', value: 'Portugal' } });
    const matchingIds = matching.map((r) => r.id);
    expect(matchingIds).toHaveLength(24);
    const selected = new Set(matchingIds); // what "Select all 24 matching" does
    expect(rows.filter((r) => selected.has(r.id)).every((r) => r.country === 'Portugal')).toBe(true);
    expect(selected.size).toBe(24);
  });

  it('never keeps a row that is no longer visible: the other tab and filtered-out rows drop out', () => {
    const sel = new Set(['a', 'b', 'c']);
    expect([...pruneSelection(sel, ['a', 'c', 'z'])].sort()).toEqual(['a', 'c']);
    expect(pruneSelection(sel, []).size).toBe(0);
  });
});

describe('move — Prompt AL759 §C', () => {
  it('goes to the other tab, with the right label: Past investments from Current, Current from Past', () => {
    expect(moveTarget('current')).toBe('past');
    expect(moveTarget('past')).toBe('current');
    expect(moveButtonLabel('current', 3)).toBe('Move to Past investments');
    expect(moveButtonLabel('past', 3)).toBe('Move to Current');
  });

  it('over 500 selected the button says "Move 500 at a time", and the ids go in batches of 500', () => {
    expect(moveButtonLabel('current', 500)).toBe('Move to Past investments');
    expect(moveButtonLabel('current', 501)).toBe('Move 500 at a time');
    const ids = Array.from({ length: 1200 }, (_, i) => `id${i}`);
    expect(chunkIds(ids).map((b) => b.length)).toEqual([500, 500, 200]);
    expect(MOVE_BATCH_SIZE).toBe(500);
    expect(chunkIds([])).toEqual([]);
  });

  it('Current -> Past never asks', () => {
    expect(moveConfirmation([co('A', { exit_at: '2024-01-01' })], 'past').needed).toBe(false);
  });

  it('Past -> Current asks once, naming how many have exit data — and only when some do', () => {
    const rows = [co('A', { status: 'past', exit_at: '2024-01-01' }), co('B', { status: 'past', exit_type: 'ipo' }), co('C', { status: 'past' })];
    const c = moveConfirmation(rows, 'current');
    expect(c.needed).toBe(true);
    expect(c.withExitData).toBe(2);
    expect(c.text).toBe('Moving 3 companies to Current will clear their exit date and exit type (2 of them have one). Move?');
    const none = moveConfirmation([co('C', { status: 'past' })], 'current');
    expect(none.needed).toBe(false);
  });

  it('the result sums the batches and says out loud when one failed', () => {
    const ok = summarizeMoveResults([{ ok: true, moved: 500, clearedExitData: 10 }, { ok: true, moved: 200, clearedExitData: 5 }], 'current');
    expect(ok).toMatchObject({ moved: 700, clearedExitData: 15, failedBatches: 0, totalBatches: 2, text: '700 companies moved to Current.' });
    const partial = summarizeMoveResults([{ ok: true, moved: 500, clearedExitData: 0 }, { ok: false }], 'past');
    expect(partial.failedBatches).toBe(1);
    expect(partial.text).toBe('500 companies moved to Past. Add the exit date and type with Edit. 1 of 2 batches failed — those companies were not moved.');
    expect(summarizeMoveResults([{ ok: false }], 'past').text).toMatch(/^Nothing was moved to Past\./);
    expect(summarizeMoveResults([{ ok: true, moved: 3, clearedExitData: 0 }], 'past').text).toBe('3 companies moved to Past. Add the exit date and type with Edit.');
    expect(summarizeMoveResults([{ ok: true, moved: 1, clearedExitData: 0 }], 'current').text).toBe('1 company moved to Current.');
  });

  it('validateMoveBody: 1..500 uuid ids and a real destination', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(validateMoveBody({ ids: [id], to: 'past' })).toEqual({ ids: [id], to: 'past' });
    expect(validateMoveBody({ ids: [id, id], to: 'current' })).toEqual({ ids: [id], to: 'current' });
    for (const bad of [null, {}, { ids: [], to: 'past' }, { ids: [id], to: 'x' }, { ids: ['nope'], to: 'past' }, { ids: id, to: 'past' }]) {
      expect('error' in validateMoveBody(bad)).toBe(true);
    }
    expect('error' in validateMoveBody({ ids: Array.from({ length: 501 }, () => id), to: 'past' })).toBe(true);
  });
});

describe('keyboard — ARIA combobox (Adenda §D.1)', () => {
  const open = { open: true, count: 3 };

  it('ArrowDown/ArrowUp walk the suggestions and wrap', () => {
    expect(comboKeyAction({ ...open, activeIndex: -1 }, 'ArrowDown')).toEqual({ type: 'move', activeIndex: 0 });
    expect(comboKeyAction({ ...open, activeIndex: 0 }, 'ArrowDown')).toEqual({ type: 'move', activeIndex: 1 });
    expect(comboKeyAction({ ...open, activeIndex: 2 }, 'ArrowDown')).toEqual({ type: 'move', activeIndex: 0 });
    expect(comboKeyAction({ ...open, activeIndex: 0 }, 'ArrowUp')).toEqual({ type: 'move', activeIndex: 2 });
    expect(comboKeyAction({ ...open, activeIndex: -1 }, 'ArrowUp')).toEqual({ type: 'move', activeIndex: 2 });
  });

  it('an arrow on a closed list opens it; with nothing to suggest it does nothing', () => {
    expect(comboKeyAction({ open: false, activeIndex: -1, count: 3 }, 'ArrowDown')).toEqual({ type: 'open' });
    expect(comboKeyAction({ open: true, activeIndex: -1, count: 0 }, 'ArrowDown')).toEqual({ type: 'none' });
  });

  it('Enter chooses the highlighted suggestion; with none highlighted it submits the typed text', () => {
    expect(comboKeyAction({ ...open, activeIndex: 1 }, 'Enter')).toEqual({ type: 'choose', index: 1 });
    expect(comboKeyAction({ ...open, activeIndex: -1 }, 'Enter')).toEqual({ type: 'submit' });
    expect(comboKeyAction({ open: false, activeIndex: 1, count: 3 }, 'Enter')).toEqual({ type: 'submit' });
    expect(comboKeyAction({ open: true, activeIndex: -1, count: 0 }, 'Enter')).toEqual({ type: 'submit' });
  });

  it('Esc closes an open list; Tab and other keys are left alone', () => {
    expect(comboKeyAction({ ...open, activeIndex: 0 }, 'Escape')).toEqual({ type: 'close' });
    expect(comboKeyAction({ open: false, activeIndex: -1, count: 3 }, 'Escape')).toEqual({ type: 'none' });
    expect(comboKeyAction({ ...open, activeIndex: 0 }, 'Tab')).toEqual({ type: 'none' });
    expect(comboKeyAction({ ...open, activeIndex: 0 }, 'a')).toEqual({ type: 'none' });
  });
});

describe('normalizeText', () => {
  it('drops accents, case and extra whitespace', () => {
    expect(normalizeText('  JOÃO   Silva ')).toBe('joao silva');
    expect(normalizeText(null)).toBe('');
  });
});
