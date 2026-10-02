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

export interface PortfolioColumn { key: PortfolioColumnKey; label: string }

const SHARED_BEFORE: PortfolioColumn[] = [
  { key: 'company', label: 'Company' },
  { key: 'website', label: 'Website' },
  { key: 'geography', label: 'Geography' },
  { key: 'stage', label: 'Stage at entry' },
  { key: 'sectors', label: 'Sectors' },
  { key: 'ticket', label: 'Ticket' },
  { key: 'instrument', label: 'Instrument' },
  { key: 'invested_on', label: 'Invested on' },
];
const PAST_ONLY: PortfolioColumn[] = [
  { key: 'exit_date', label: 'Exit date' },
  { key: 'exit_type', label: 'Exit type' },
];
const SHARED_AFTER: PortfolioColumn[] = [{ key: 'contact', label: 'Contact' }];

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
