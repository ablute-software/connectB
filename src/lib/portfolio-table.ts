// Prompt AL758 — pure rules for the investor Portfolio tables (Current/Past).
//
// Everything with an edge case lives here rather than inside the component:
// which columns each tab has, how a page number from the URL is turned into
// a page that actually exists, and where the investor lands after changing
// the list. No React, no browser — tested directly.
import { pageCount } from './queue-table-state';

/**
 * Nuno asked for 20 per page. The pipeline's own band size is 25
 * (DEFAULT_PAGE_SIZE in queue-table-state.ts) and stays 25 — this constant
 * belongs to the Portfolio alone.
 */
export const PORTFOLIO_PAGE_SIZE = 20;

export type PortfolioTab = 'current' | 'past';

export type PortfolioColumnKey =
  | 'company' | 'website' | 'geography' | 'stage' | 'sectors' | 'ticket' | 'instrument'
  | 'invested_on' | 'exit_date' | 'exit_type' | 'contact';

/** Prompt AL759 §D — the columns a click on the header can sort by. Website, Stage, Sectors, Instrument and Exit type are deliberately not sortable. */
export type PortfolioSortKey = 'company' | 'geography' | 'ticket' | 'invested_on' | 'exit_date' | 'contact';

export interface PortfolioColumn { key: PortfolioColumnKey; label: string; sortKey?: PortfolioSortKey }

const SHARED_BEFORE: PortfolioColumn[] = [
  { key: 'company', label: 'Company', sortKey: 'company' },
  { key: 'website', label: 'Website' },
  { key: 'geography', label: 'Geography', sortKey: 'geography' },
  { key: 'stage', label: 'Stage at entry' },
  { key: 'sectors', label: 'Sectors' },
  { key: 'ticket', label: 'Ticket', sortKey: 'ticket' },
  { key: 'instrument', label: 'Instrument' },
  { key: 'invested_on', label: 'Invested on', sortKey: 'invested_on' },
];
const PAST_ONLY: PortfolioColumn[] = [
  { key: 'exit_date', label: 'Exit date', sortKey: 'exit_date' },
  { key: 'exit_type', label: 'Exit type' },
];
const SHARED_AFTER: PortfolioColumn[] = [{ key: 'contact', label: 'Contact', sortKey: 'contact' }];

/**
 * Current and Past each have their own columns. Past gets Exit date and Exit
 * type as two SEPARATE columns (they used to share one "Exit" cell), placed
 * between Invested on and Contact — the order Nuno specified.
 */
export function portfolioColumns(tab: PortfolioTab): PortfolioColumn[] {
  return tab === 'past'
    ? [...SHARED_BEFORE, ...PAST_ONLY, ...SHARED_AFTER]
    : [...SHARED_BEFORE, ...SHARED_AFTER];
}

/** The line shown under the header when a tab has no rows — never instead of the header. */
export function emptyStateText(tab: PortfolioTab): string {
  return `No ${tab} companies yet. Add one manually, or import a CSV/Excel using the template.`;
}

/** A hand-edited or stale ?page= degrades to page 1, never to NaN or a negative page. */
export function parsePageParam(raw: string | null): number {
  return Math.max(1, Math.floor(Number(raw)) || 1);
}

/**
 * A page that exists. The URL can say page=9 after the investor deleted the
 * last row of page 3, or from an old link — either way the list must show
 * the nearest real page rather than an empty table that reads as a bug.
 */
export function clampPage(page: number, total: number, pageSize: number = PORTFOLIO_PAGE_SIZE): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize));
}

export function pageSlice<T>(rows: T[], page: number, pageSize: number = PORTFOLIO_PAGE_SIZE): T[] {
  const p = clampPage(page, rows.length, pageSize);
  return rows.slice((p - 1) * pageSize, p * pageSize);
}

export interface PortfolioViewState { tab: PortfolioTab; page: number }

/**
 * Where the investor lands after the list changes — one place, so
 * "never stay on a page that no longer exists" cannot be forgotten by one
 * caller.
 *
 *  - add / import: the list is newest-first (created_at desc), so a new row
 *    always appears on page 1; go there so the investor sees it. An import
 *    also moves to whichever tab the rows landed in.
 *  - edit / remove: stay where they were; the page is re-clamped against the
 *    new total once the reloaded list arrives (so removing the only row on
 *    page 3 steps back to page 2).
 *  - switching tab: always page 1 of the other tab.
 */
export function viewAfter(
  current: PortfolioViewState,
  event:
    | { type: 'switch-tab'; tab: PortfolioTab }
    | { type: 'added' }
    | { type: 'imported'; landedIn?: PortfolioTab }
    | { type: 'edited' | 'removed' },
  totalInCurrentTab?: number,
): PortfolioViewState {
  switch (event.type) {
    case 'switch-tab': return { tab: event.tab, page: 1 };
    case 'added': return { tab: current.tab, page: 1 };
    case 'imported': return { tab: event.landedIn ?? current.tab, page: 1 };
    case 'edited':
    case 'removed':
      return { tab: current.tab, page: totalInCurrentTab === undefined ? current.page : clampPage(current.page, totalInCurrentTab) };
  }
}

// Display labels, shared by the tables, the Add/Edit form and the import
// preview so one value never reads two different ways on one screen.
export const STAGE_LABELS: Record<string, string> = {
  pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b: 'Series B',
  series_c_plus: 'Series C+', later: 'Later', other: 'Other',
};
export const INSTRUMENT_LABELS: Record<string, string> = {
  equity: 'Equity', safe: 'SAFE', convertible_note: 'Convertible note', other: 'Other',
};
export const EXIT_TYPE_LABELS: Record<string, string> = {
  acquisition: 'Acquisition', ipo: 'IPO', write_off: 'Write-off', other: 'Other',
};

/** One saved row as GET /api/portal/investor-profile/portfolio returns it. */
export interface PortfolioCompany {
  id: string; status: PortfolioTab; company_name: string; website: string | null; domain: string | null;
  country: string | null; stage_at_entry: string | null; sectors: string[]; ticket_eur: number | null;
  instrument: string | null; invested_at: string | null; exit_at: string | null; exit_type: string | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  source: 'manual' | 'import'; created_at: string;
}

// ============================================================================
// Prompt AL759 — search with per-field suggestions, sort, selection, move.
// Everything below is pure (no React, no browser) and runs on the rows the
// panel already has in memory: the list is paged in the client (Nuno,
// 02/10/2026: no server paging), so filtering and sorting the WHOLE set
// before slicing a page is just array work.
// ============================================================================

/** Accent- and case-insensitive, whitespace-collapsed — the one comparison form every search/sort below uses. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const byCreatedDesc = (a: PortfolioCompany, b: PortfolioCompany) => b.created_at.localeCompare(a.created_at);

// ---------- sort ----------

export type SortDir = 'asc' | 'desc';
export interface SortState { key: PortfolioSortKey | null; dir: SortDir }
export const NO_SORT: SortState = { key: null, dir: 'asc' };

export function sortKeysFor(tab: PortfolioTab): PortfolioSortKey[] {
  return portfolioColumns(tab).flatMap((c) => (c.sortKey ? [c.sortKey] : []));
}

/** ascending -> descending -> back to the default order (newest first, no arrow). Another column starts at ascending. */
export function nextSort(current: SortState, key: PortfolioSortKey): SortState {
  if (current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return NO_SORT;
}

type SortValue = string | number | null;

function sortValue(c: PortfolioCompany, key: PortfolioSortKey): SortValue {
  switch (key) {
    case 'company': return normalizeText(c.company_name) || null;
    case 'geography': return normalizeText(c.country) || null;
    case 'contact': return normalizeText(c.contact_name) || null;
    case 'ticket': return c.ticket_eur;
    // ISO strings sort correctly as text; never the formatted "15 Mar 2022".
    case 'invested_on': return c.invested_at ? c.invested_at.slice(0, 10) : null;
    case 'exit_date': return c.exit_at ? c.exit_at.slice(0, 10) : null;
  }
}

/**
 * Sorts the whole set. Empty values go LAST in both directions (a company
 * with no ticket must never head a ticket sort), numbers and ISO dates
 * compare by value, text by its accent-less form, and ties fall back to the
 * default order so the result is stable.
 */
export function sortCompanies(rows: PortfolioCompany[], sort: SortState): PortfolioCompany[] {
  if (!sort.key) return [...rows].sort(byCreatedDesc);
  const key = sort.key;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return byCreatedDesc(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return cmp !== 0 ? sign * cmp : byCreatedDesc(a, b);
  });
}

// ---------- search / tagged filter ----------

export type FilterField = 'company' | 'country' | 'sector' | 'contact';
export const FILTER_FIELDS: FilterField[] = ['company', 'country', 'sector', 'contact'];
export const FILTER_FIELD_LABELS: Record<FilterField, string> = {
  company: 'Company', country: 'Country', sector: 'Sector', contact: 'Contact',
};

export interface TaggedFilter { field: FilterField; value: string }
export interface PortfolioQuery { q: string; filter: TaggedFilter | null }
export const EMPTY_QUERY: PortfolioQuery = { q: '', filter: null };

export function hasQuery(query: PortfolioQuery): boolean {
  return normalizeText(query.q) !== '' || query.filter !== null;
}

/** "Country: Portugal" */
export function filterLabel(f: TaggedFilter): string {
  return `${FILTER_FIELD_LABELS[f.field]}: ${f.value}`;
}

/**
 * A suggestion picked from the dropdown filters by THAT field only, by
 * equality (not substring): Country: Portugal is the three companies HQ'd
 * in Portugal — not "Portugal Dogs" and not the contact "Ana Portugal".
 * Sector matches a company that CONTAINS the sector (it has several).
 */
export function matchesFilter(c: PortfolioCompany, f: TaggedFilter): boolean {
  const want = normalizeText(f.value);
  switch (f.field) {
    case 'company': return normalizeText(c.company_name) === want;
    case 'country': return normalizeText(c.country) === want;
    case 'contact': return normalizeText(c.contact_name) === want;
    case 'sector': return c.sectors.some((s) => normalizeText(s) === want);
  }
}

/** Free text: substring, in company name, sectors, country and contact name. */
export function matchesText(c: PortfolioCompany, q: string): boolean {
  const t = normalizeText(q);
  if (!t) return true;
  return normalizeText(c.company_name).includes(t)
    || c.sectors.some((s) => normalizeText(s).includes(t))
    || normalizeText(c.country).includes(t)
    || normalizeText(c.contact_name).includes(t);
}

export function filterCompanies(rows: PortfolioCompany[], query: PortfolioQuery): PortfolioCompany[] {
  return rows.filter((c) => (!query.filter || matchesFilter(c, query.filter)) && matchesText(c, query.q));
}

/** Where a free-text search first matched: name 0, country 1, sector 2, contact 3. Lower is more relevant. */
export function relevanceRank(c: PortfolioCompany, q: string): 0 | 1 | 2 | 3 | null {
  const t = normalizeText(q);
  if (!t) return null;
  if (normalizeText(c.company_name).includes(t)) return 0;
  if (normalizeText(c.country).includes(t)) return 1;
  if (c.sectors.some((s) => normalizeText(s).includes(t))) return 2;
  if (normalizeText(c.contact_name).includes(t)) return 3;
  return null;
}

/**
 * The list the investor sees, before paging: filter first, then EITHER the
 * investor's own column sort (which always wins) OR — only when a free-text
 * search is active and nothing is sorted — relevance (name matches first,
 * then country, sector, contact; newest first inside each), OR the default
 * newest-first order. The whole filtered set is ordered, then paged.
 */
export function arrangeCompanies(rows: PortfolioCompany[], query: PortfolioQuery, sort: SortState): PortfolioCompany[] {
  const filtered = filterCompanies(rows, query);
  if (sort.key) return sortCompanies(filtered, sort);
  if (normalizeText(query.q)) {
    return [...filtered].sort((a, b) => {
      const ra = relevanceRank(a, query.q) ?? 9;
      const rb = relevanceRank(b, query.q) ?? 9;
      return ra !== rb ? ra - rb : byCreatedDesc(a, b);
    });
  }
  return sortCompanies(filtered, NO_SORT);
}

export function noMatchText(query: PortfolioQuery): string {
  const parts: string[] = [];
  if (normalizeText(query.q)) parts.push(`"${query.q.trim()}"`);
  if (query.filter) parts.push(filterLabel(query.filter));
  return `No companies match ${parts.join(' + ')}.`;
}

// ---------- highlight ----------

export interface HighlightPart { text: string; match: boolean }

/**
 * Splits `text` into plain and matched parts for the query, ignoring accents
 * and case ("espana" lights up "España"). Works on the ORIGINAL characters
 * (an accent-stripped copy keeps a map back), so the displayed text is never
 * altered — only wrapped.
 */
export function highlightParts(text: string | null | undefined, query: string): HighlightPart[] {
  const src = text ?? '';
  const q = normalizeText(query);
  if (!src || !q) return [{ text: src, match: false }];
  let norm = '';
  const origIndex: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const n = src[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < n.length; k++) { norm += n[k]; origIndex.push(i); }
  }
  const parts: HighlightPart[] = [];
  let from = 0;
  let cursor = 0;
  for (;;) {
    const at = norm.indexOf(q, from);
    if (at === -1) break;
    const start = origIndex[at];
    const end = origIndex[at + q.length - 1] + 1;
    if (start > cursor) parts.push({ text: src.slice(cursor, start), match: false });
    parts.push({ text: src.slice(start, end), match: true });
    cursor = end;
    from = at + q.length;
  }
  if (cursor < src.length) parts.push({ text: src.slice(cursor), match: false });
  return parts.length ? parts : [{ text: src, match: false }];
}

// ---------- suggestions ----------

export const SUGGESTION_MIN_CHARS = 2;
export const SUGGESTIONS_PER_GROUP = 3;
export const SUGGESTIONS_TOTAL = 8;

export interface Suggestion { id: string; field: FilterField; value: string; count: number }

/** Company, Country, Sector, Contact — the order the groups appear in. */
const SUGGESTION_GROUP_ORDER: FilterField[] = ['company', 'country', 'sector', 'contact'];

function distinctValues(rows: PortfolioCompany[], field: FilterField): Map<string, { value: string; count: number }> {
  const out = new Map<string, { value: string; count: number }>();
  const add = (raw: string | null | undefined) => {
    const value = (raw ?? '').trim();
    const key = normalizeText(value);
    if (!key) return;
    const cur = out.get(key);
    if (cur) cur.count++; else out.set(key, { value, count: 1 });
  };
  for (const c of rows) {
    if (field === 'company') add(c.company_name);
    else if (field === 'country') add(c.country);
    else if (field === 'contact') add(c.contact_name);
    else for (const s of new Set(c.sectors.map((x) => x.trim()).filter(Boolean))) add(s);
  }
  return out;
}

/**
 * Suggestions for what is being typed, computed from the active tab's own
 * rows — grouped by field, repeated values merged into one with a count
 * ("Country: Portugal (3)", not three Portugals). From 2 characters; at most
 * 3 per group and 8 in all; a group with nothing to suggest does not appear.
 * Inside a group, values that START a word with the text come first, then the
 * rest, then by count and name.
 */
export function suggest(rows: PortfolioCompany[], text: string): Suggestion[] {
  const t = normalizeText(text);
  if (t.length < SUGGESTION_MIN_CHARS) return [];
  const out: Suggestion[] = [];
  for (const field of SUGGESTION_GROUP_ORDER) {
    const candidates = [...distinctValues(rows, field).entries()]
      .filter(([key]) => key.includes(t))
      .map(([key, v]) => ({ ...v, startsWord: key.split(' ').some((w) => w.startsWith(t)) }))
      .sort((a, b) => Number(b.startsWord) - Number(a.startsWord) || b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, SUGGESTIONS_PER_GROUP);
    for (const c of candidates) {
      if (out.length >= SUGGESTIONS_TOTAL) return out;
      out.push({ id: `${field}:${normalizeText(c.value)}`, field, value: c.value, count: c.count });
    }
  }
  return out;
}

/** "Country · Portugal (3)" — the count is shown unless it is a Company that appears once. */
export function showSuggestionCount(s: Suggestion): boolean {
  return s.field !== 'company' || s.count > 1;
}

// ---------- keyboard (ARIA combobox) ----------

export type ComboKeyAction =
  | { type: 'move'; activeIndex: number }
  | { type: 'choose'; index: number }
  | { type: 'submit' }
  | { type: 'close' }
  | { type: 'open' }
  | { type: 'none' };

/**
 * What a key does in the search box. Arrows walk the suggestions (wrapping),
 * Enter chooses the highlighted one — or, with none highlighted, submits the
 * typed text as a general search — Esc closes, Tab leaves untouched.
 */
export function comboKeyAction(state: { open: boolean; activeIndex: number; count: number }, key: string): ComboKeyAction {
  const { open, activeIndex, count } = state;
  switch (key) {
    case 'ArrowDown':
      if (count === 0) return { type: 'none' };
      if (!open) return { type: 'open' };
      return { type: 'move', activeIndex: activeIndex < 0 ? 0 : (activeIndex + 1) % count };
    case 'ArrowUp':
      if (count === 0) return { type: 'none' };
      if (!open) return { type: 'open' };
      return { type: 'move', activeIndex: activeIndex <= 0 ? count - 1 : activeIndex - 1 };
    case 'Enter':
      return open && activeIndex >= 0 && activeIndex < count ? { type: 'choose', index: activeIndex } : { type: 'submit' };
    case 'Escape': return open ? { type: 'close' } : { type: 'none' };
    default: return { type: 'none' };
  }
}

// ---------- URL state: ?q= ?f= ?sort= ?dir= ----------

export interface PortfolioListState { query: PortfolioQuery; sort: SortState }
export const EMPTY_LIST_STATE: PortfolioListState = { query: EMPTY_QUERY, sort: NO_SORT };

/** `country:Portugal` -> a filter. An unknown field, a missing colon or an empty value is IGNORED, never an error. */
export function parseFilterParam(raw: string | null): TaggedFilter | null {
  if (!raw) return null;
  const i = raw.indexOf(':');
  if (i <= 0) return null;
  const field = raw.slice(0, i);
  const value = raw.slice(i + 1).trim();
  if (!value || !(FILTER_FIELDS as string[]).includes(field)) return null;
  return { field: field as FilterField, value };
}

export function parseListParams(params: URLSearchParams, tab: PortfolioTab): PortfolioListState {
  const rawKey = params.get('sort');
  const key = rawKey && (sortKeysFor(tab) as string[]).includes(rawKey) ? (rawKey as PortfolioSortKey) : null;
  return {
    query: { q: (params.get('q') ?? '').trim(), filter: parseFilterParam(params.get('f')) },
    sort: key ? { key, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' } : NO_SORT,
  };
}

/** Writes the list state into `params`: defaults stay out of the URL. */
export function writeListParams(params: URLSearchParams, state: PortfolioListState): void {
  const q = state.query.q.trim();
  if (q) params.set('q', q); else params.delete('q');
  if (state.query.filter) params.set('f', `${state.query.filter.field}:${state.query.filter.value}`); else params.delete('f');
  if (state.sort.key) { params.set('sort', state.sort.key); params.set('dir', state.sort.dir); } else { params.delete('sort'); params.delete('dir'); }
}

export function sameListState(a: PortfolioListState, b: PortfolioListState): boolean {
  return a.query.q.trim() === b.query.q.trim()
    && a.query.filter?.field === b.query.filter?.field
    && a.query.filter?.value === b.query.filter?.value
    && a.sort.key === b.sort.key
    && (a.sort.key === null || a.sort.dir === b.sort.dir);
}

/**
 * Changing the tab clears search, filter and sort (each tab is a different
 * list); an add/import resets them so the new row is actually visible.
 * Edit/remove keep them. Returns the list state to write alongside the new
 * tab/page.
 */
export function listAfter(
  current: PortfolioListState,
  event: 'switch-tab' | 'added' | 'imported' | 'edited' | 'removed',
): PortfolioListState {
  return event === 'edited' || event === 'removed' ? current : EMPTY_LIST_STATE;
}

// ---------- selection ----------

export type PageSelection = 'none' | 'some' | 'all';

export function pageSelection(selected: ReadonlySet<string>, pageIds: string[]): PageSelection {
  if (pageIds.length === 0) return 'none';
  const n = pageIds.filter((id) => selected.has(id)).length;
  return n === 0 ? 'none' : n === pageIds.length ? 'all' : 'some';
}

/** The header checkbox: selects the visible page, or — when it is already fully selected — unselects it. With a single page, the page IS everything. */
export function togglePageSelection(selected: ReadonlySet<string>, pageIds: string[]): Set<string> {
  const next = new Set(selected);
  if (pageSelection(selected, pageIds) === 'all') for (const id of pageIds) next.delete(id);
  else for (const id of pageIds) next.add(id);
  return next;
}

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** Drops ids that are no longer in the visible (tab + filter) list — a stale or hidden row is never moved. */
export function pruneSelection(selected: ReadonlySet<string>, visibleIds: Iterable<string>): Set<string> {
  const visible = new Set(visibleIds);
  return new Set([...selected].filter((id) => visible.has(id)));
}

export type SelectAllPrompt =
  | { kind: 'select-all'; onPage: number; total: number }
  | { kind: 'all-selected'; total: number }
  | null;

/**
 * The line under the action bar: "20 selected on this page · Select all 37
 * matching" once a whole page is selected and more rows match than fit on it,
 * then "All 37 selected · Clear". Nothing on a single page — there, the
 * header checkbox already selected everything.
 */
export function selectAllPrompt(selected: ReadonlySet<string>, pageIds: string[], matchingIds: string[]): SelectAllPrompt {
  if (matchingIds.length <= pageIds.length) return null;
  if (matchingIds.every((id) => selected.has(id))) return { kind: 'all-selected', total: matchingIds.length };
  if (pageSelection(selected, pageIds) === 'all') return { kind: 'select-all', onPage: pageIds.length, total: matchingIds.length };
  return null;
}

// ---------- move ----------

export const MOVE_BATCH_SIZE = 500;

export function chunkIds(ids: string[], size: number = MOVE_BATCH_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export function moveTarget(tab: PortfolioTab): PortfolioTab {
  return tab === 'current' ? 'past' : 'current';
}

export function moveButtonLabel(tab: PortfolioTab, selectedCount: number): string {
  if (selectedCount > MOVE_BATCH_SIZE) return `Move ${MOVE_BATCH_SIZE} at a time`;
  return tab === 'current' ? 'Move to Past investments' : 'Move to Current';
}

/**
 * Past -> Current clears exit date and exit type, so it asks once — but only
 * when at least one selected company actually has exit data to lose. Current
 * -> Past never asks.
 */
export function moveConfirmation(selectedRows: PortfolioCompany[], to: PortfolioTab): { needed: boolean; text: string; withExitData: number } {
  if (to !== 'current') return { needed: false, text: '', withExitData: 0 };
  const withExitData = selectedRows.filter((r) => r.exit_at || r.exit_type).length;
  if (withExitData === 0) return { needed: false, text: '', withExitData };
  const n = selectedRows.length;
  return {
    needed: true, withExitData,
    text: `Moving ${n} ${n === 1 ? 'company' : 'companies'} to Current will clear their exit date and exit type (${withExitData} of them ${withExitData === 1 ? 'has' : 'have'} one). Move?`,
  };
}

export type MoveBatchResult = { ok: true; moved: number; clearedExitData: number } | { ok: false };

/** The result banner's numbers and text — batches are summed, and a failed batch is said out loud. */
export function summarizeMoveResults(results: MoveBatchResult[], to: PortfolioTab): {
  moved: number; clearedExitData: number; failedBatches: number; totalBatches: number; text: string;
} {
  let moved = 0;
  let clearedExitData = 0;
  let failedBatches = 0;
  for (const r of results) { if (r.ok) { moved += r.moved; clearedExitData += r.clearedExitData; } else failedBatches++; }
  const label = to === 'past' ? 'Past' : 'Current';
  const companies = `${moved} ${moved === 1 ? 'company' : 'companies'}`;
  let text = moved > 0 ? `${companies} moved to ${label}.` : `Nothing was moved to ${label}.`;
  if (moved > 0 && to === 'past') text += ' Add the exit date and type with Edit.';
  if (failedBatches > 0) {
    text += ` ${failedBatches} of ${results.length} ${results.length === 1 ? 'batch' : 'batches'} failed — those companies were not moved.`;
  }
  return { moved, clearedExitData, failedBatches, totalBatches: results.length, text };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The move route's body check: 1..500 uuid ids, and a real destination. */
export function validateMoveBody(body: unknown): { error: string } | { ids: string[]; to: PortfolioTab } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.to !== 'current' && b.to !== 'past') return { error: '"to" must be "current" or "past".' };
  if (!Array.isArray(b.ids) || b.ids.length === 0) return { error: '"ids" must be a non-empty array.' };
  if (b.ids.length > MOVE_BATCH_SIZE) return { error: `At most ${MOVE_BATCH_SIZE} ids per request.` };
  if (!b.ids.every((x) => typeof x === 'string' && UUID_RE.test(x))) return { error: '"ids" must all be valid ids.' };
  return { ids: [...new Set(b.ids as string[])], to: b.to };
}
