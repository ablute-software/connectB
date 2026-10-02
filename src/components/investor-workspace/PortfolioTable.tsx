'use client';
// Prompt AL758 — the investor's portfolio table, one per tab. Presentational
// on purpose (no router, no fetching): the panel owns the data and the URL,
// this draws it — which is also what lets it be rendered directly in a test.
//
// The header is ALWAYS drawn, including with zero rows, so an investor who
// has added nothing yet can still see what information a company carries.
// The empty state is one row UNDER the header, never in place of the table.
//
// Prompt AL759 adds, all optional so a plain render is unchanged: a checkbox
// column (selection), click-to-sort headers, the general-search highlight, and
// the "no companies match" body.
import type { ReactNode } from 'react';
import { formatTicketEur } from '@/lib/ticket-range';
import { formatDateDisplay } from '@/lib/portfolio-import';
import {
  EXIT_TYPE_LABELS, INSTRUMENT_LABELS, PORTFOLIO_PAGE_SIZE, STAGE_LABELS, clampPage, emptyStateText, highlightParts,
  pageSlice, portfolioColumns, type PageSelection, type PortfolioColumnKey, type PortfolioCompany, type PortfolioSortKey,
  type PortfolioTab, type SortState,
} from '@/lib/portfolio-table';
import { Pager } from '@/components/Pager';

const DASH = '—';

function dateCell(iso: string | null): string {
  return iso ? formatDateDisplay(iso.slice(0, 10)) : DASH;
}

/** `text` with the searched text wrapped in <mark> wherever it occurs (accent- and case-insensitive); untouched when there is no query. */
export function Highlighted({ text, query }: { text: string; query?: string }): ReactNode {
  if (!query) return text;
  return highlightParts(text, query).map((p, i) => (p.match
    ? <mark key={i} className="rounded-sm bg-yellow-100 px-0 text-gray-900">{p.text}</mark>
    : <span key={i}>{p.text}</span>));
}

/** One cell's content, shared with the import preview's sample table so a row reads identically before and after it is saved. */
export function portfolioCell(key: PortfolioColumnKey, c: PortfolioCompany, highlight?: string): ReactNode {
  switch (key) {
    case 'company': return <span className="font-medium text-gray-900"><Highlighted text={c.company_name} query={highlight} /></span>;
    case 'website':
      return c.website
        ? <a href={c.website} target="_blank" rel="noreferrer" className="hover:underline">{c.domain ?? c.website}</a>
        : DASH;
    case 'geography': return c.country ? <Highlighted text={c.country} query={highlight} /> : DASH;
    case 'stage': return c.stage_at_entry ? STAGE_LABELS[c.stage_at_entry] ?? c.stage_at_entry : DASH;
    case 'sectors': return c.sectors.length ? <Highlighted text={c.sectors.join(', ')} query={highlight} /> : DASH;
    case 'ticket': return c.ticket_eur != null ? formatTicketEur(c.ticket_eur) : DASH;
    case 'instrument': return c.instrument ? INSTRUMENT_LABELS[c.instrument] ?? c.instrument : DASH;
    case 'invested_on': return dateCell(c.invested_at);
    case 'exit_date': return dateCell(c.exit_at);
    case 'exit_type': return c.exit_type ? EXIT_TYPE_LABELS[c.exit_type] ?? c.exit_type : DASH;
    case 'contact': {
      // Only the contact NAME is searched, so only the name is highlighted —
      // an email that happens to contain the text did not make the row match.
      const rest = [c.contact_email, c.contact_phone].filter(Boolean);
      if (!c.contact_name && rest.length === 0) return DASH;
      return (
        <>
          {c.contact_name ? <Highlighted text={c.contact_name} query={highlight} /> : null}
          {c.contact_name && rest.length ? ' · ' : null}
          {rest.join(' · ')}
        </>
      );
    }
  }
}

export interface PortfolioTableSelection {
  selectedIds: ReadonlySet<string>;
  pageSelection: PageSelection;
  onTogglePage: () => void;
  onToggleOne: (id: string) => void;
}

export function PortfolioTable({
  tab, companies, page, totalInTab, loading = false, confirmRemoveId, removeBusy = false,
  selection, sort, onSort, highlight, noMatch,
  onPageChange, onEdit, onAskRemove, onConfirmRemove, onCancelRemove,
}: {
  tab: PortfolioTab;
  /** Every row to show for THIS tab — already filtered and ordered; the table slices its own page. */
  companies: PortfolioCompany[];
  page: number;
  /** All rows of the tab before any search/filter — drives "8 of 37 companies". Defaults to companies.length. */
  totalInTab?: number;
  loading?: boolean;
  confirmRemoveId?: string | null;
  removeBusy?: boolean;
  selection?: PortfolioTableSelection;
  sort?: SortState;
  onSort?: (key: PortfolioSortKey) => void;
  /** General-search text to light up in the cells where it matched. */
  highlight?: string;
  /** Set when a search/filter is active: what to say (and how to clear it) when nothing matches. */
  noMatch?: { text: string; onClear: () => void };
  onPageChange: (page: number) => void;
  onEdit: (id: string) => void;
  onAskRemove: (id: string) => void;
  onConfirmRemove: (id: string) => void;
  onCancelRemove: () => void;
}) {
  const columns = portfolioColumns(tab);
  const shown = pageSlice(companies, page);
  const effectivePage = clampPage(page, companies.length);
  // [checkbox] + the data columns + Invite + Edit + Remove.
  const colSpan = columns.length + 3 + (selection ? 1 : 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white" data-testid={`portfolio-table-${tab}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-100 text-gray-500">
            <tr>
              {selection && (
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" aria-label="Select all on this page"
                    checked={selection.pageSelection === 'all'}
                    ref={(el) => { if (el) el.indeterminate = selection.pageSelection === 'some'; }}
                    onChange={selection.onTogglePage} />
                </th>
              )}
              {columns.map((col) => {
                const sortable = !!(onSort && col.sortKey);
                const active = sortable && sort?.key === col.sortKey;
                return (
                  <th key={col.key} className="whitespace-nowrap px-3 py-2 font-medium"
                    aria-sort={sortable ? (active ? (sort?.dir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined}>
                    {sortable ? (
                      <button type="button" onClick={() => onSort!(col.sortKey!)}
                        className="inline-flex cursor-pointer items-center gap-1 font-medium hover:text-gray-800">
                        {col.label}
                        {active && <span aria-hidden="true" className="text-[9px] text-gray-500">{sort?.dir === 'desc' ? '▼' : '▲'}</span>}
                      </button>
                    ) : col.label}
                  </th>
                );
              })}
              <th className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colSpan} className="px-3 py-4 text-gray-400">Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-4 text-gray-400">
                  {noMatch ? (
                    <>{noMatch.text}{' '}
                      <button type="button" onClick={noMatch.onClear} className="font-medium text-[#0E7490] hover:underline">Clear search</button>
                    </>
                  ) : emptyStateText(tab)}
                </td>
              </tr>
            ) : shown.map((c) => (
              <tr key={c.id} className="border-b border-gray-50 last:border-0" data-testid="portfolio-row">
                {selection && (
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Select ${c.company_name}`}
                      checked={selection.selectedIds.has(c.id)} onChange={() => selection.onToggleOne(c.id)} />
                  </td>
                )}
                {columns.map((col) => <td key={col.key} className="px-3 py-2 text-gray-600">{portfolioCell(col.key, c, highlight)}</td>)}
                <td className="px-3 py-2">
                  {/* Phase 2 wires this up for real. Visibly present rather
                      than absent, so it reads as a boundary, not a bug. */}
                  <button disabled title="Coming soon"
                    className="cursor-not-allowed whitespace-nowrap rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-400">
                    Invite to Sherlock Deal <span className="text-gray-300">(Coming soon)</span>
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => onEdit(c.id)} className="text-gray-400 hover:text-[#0E7490]">Edit</button>
                </td>
                <td className="px-3 py-2 text-right">
                  {confirmRemoveId === c.id ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <span className="text-gray-500">Remove {c.company_name}?</span>
                      <button onClick={() => onConfirmRemove(c.id)} disabled={removeBusy}
                        className="font-medium text-[#B00000] hover:underline disabled:opacity-40">
                        {removeBusy ? '…' : 'Yes'}
                      </button>
                      <button onClick={onCancelRemove} className="text-gray-400 hover:underline">No</button>
                    </span>
                  ) : (
                    <button onClick={() => onAskRemove(c.id)} className="text-gray-400 hover:text-[#B00000]">Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && (
        <Pager page={effectivePage} total={companies.length} of={totalInTab} pageSize={PORTFOLIO_PAGE_SIZE} onChange={onPageChange} />
      )}
    </div>
  );
}
