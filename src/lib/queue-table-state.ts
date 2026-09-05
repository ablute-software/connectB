// Prompt 570 §C — the URL is the state.
//
// Every back-office table today is a hand-rolled <table> with no pagination
// and no sorting (checked: twelve of them, none reusable), so a reviewer who
// finds something and sends the link to someone else sends them the first page
// of an unsorted list. Putting page, sort, filters and the internal toggle in
// the query string is what makes a shared link open the same view — and it
// costs nothing else, because a route that already reads ?tab= keeps working.
//
// Pure on purpose: parsing and serialising are the parts with edge cases
// (bad numbers, unknown sort keys, someone hand-editing the URL), and they are
// the parts worth testing without a browser.

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

export type SortDir = 'asc' | 'desc';

export interface QueueTableState {
  page: number;
  pageSize: PageSize;
  sort: string | null;
  dir: SortDir;
  /** Undecided only, unless the reader asks for the rest. */
  showResolved: boolean;
  /** On by default: our own accounts do not need our review. */
  hideInternal: boolean;
  /** Free-form per-queue filters, e.g. grade=A. */
  filters: Record<string, string>;
}

const RESERVED = new Set(['page', 'size', 'sort', 'dir', 'resolved', 'internal', 'tab']);

function toPageSize(raw: string | null): PageSize {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : DEFAULT_PAGE_SIZE;
}

/**
 * Never throws and never returns a nonsense page: a hand-edited or stale URL
 * degrades to the default view rather than an empty table the reader cannot
 * explain.
 */
export function parseQueueTableState(
  params: URLSearchParams,
  opts: { sortableKeys?: string[] } = {},
): QueueTableState {
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const rawSort = params.get('sort');
  const sort = rawSort && (!opts.sortableKeys || opts.sortableKeys.includes(rawSort)) ? rawSort : null;
  const filters: Record<string, string> = {};
  for (const [k, v] of params.entries()) if (!RESERVED.has(k) && v) filters[k] = v;

  return {
    page,
    pageSize: toPageSize(params.get('size')),
    sort,
    dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
    showResolved: params.get('resolved') === 'show',
    // Absent means hidden — the default the prompt asks for, and the one that
    // makes the queue counts mean "work for us to do".
    hideInternal: params.get('internal') !== 'shown',
    filters,
  };
}

/**
 * Only non-default values are written, so the common view has a clean URL and
 * a link stays readable. `tab` (and anything else already there) is preserved:
 * this component is never the only thing using the query string.
 */
export function serializeQueueTableState(
  state: Partial<QueueTableState>,
  existing?: URLSearchParams,
): URLSearchParams {
  const out = new URLSearchParams(existing ? Array.from(existing.entries()).filter(([k]) => RESERVED.has(k) && k === 'tab') : []);

  if (state.page && state.page > 1) out.set('page', String(state.page));
  if (state.pageSize && state.pageSize !== DEFAULT_PAGE_SIZE) out.set('size', String(state.pageSize));
  if (state.sort) { out.set('sort', state.sort); out.set('dir', state.dir ?? 'desc'); }
  if (state.showResolved) out.set('resolved', 'show');
  if (state.hideInternal === false) out.set('internal', 'shown');
  for (const [k, v] of Object.entries(state.filters ?? {})) if (v) out.set(k, v);
  return out;
}

/**
 * Changing what the list contains must send the reader back to page 1 —
 * otherwise filtering from page 4 of 5 shows an empty table and reads as a
 * bug. Changing the page, obviously, must not.
 */
export function nextStateFor(
  current: QueueTableState,
  change: Partial<QueueTableState>,
): QueueTableState {
  const changesContent = ['pageSize', 'sort', 'dir', 'showResolved', 'hideInternal', 'filters']
    .some((k) => k in change);
  return { ...current, ...change, page: 'page' in change ? change.page! : changesContent ? 1 : current.page };
}

/** "Showing 1–25 of 751", and the honest empty case. */
export function rangeLabel(state: QueueTableState, total: number): string {
  if (total === 0) return 'Nothing to show';
  const first = (state.page - 1) * state.pageSize + 1;
  const last = Math.min(total, state.page * state.pageSize);
  return `Showing ${first}–${last} of ${total}`;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clicking the sorted column flips it; clicking another switches to it. */
export function toggleSort(current: QueueTableState, key: string): Pick<QueueTableState, 'sort' | 'dir'> {
  if (current.sort !== key) return { sort: key, dir: 'desc' };
  return { sort: key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
}
