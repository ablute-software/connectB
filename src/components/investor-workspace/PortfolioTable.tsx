'use client';
// Prompt AL758 — the investor's portfolio table, one per tab. Presentational
// on purpose (no router, no fetching): the panel owns the data and the URL,
// this draws it — which is also what lets it be rendered directly in a test.
//
// The header is ALWAYS drawn, including with zero rows, so an investor who
// has added nothing yet can still see what information a company carries.
// The empty state is one row UNDER the header, never in place of the table.
import { formatTicketEur } from '@/lib/ticket-range';
import { formatDateDisplay } from '@/lib/portfolio-import';
import {
  EXIT_TYPE_LABELS, INSTRUMENT_LABELS, PORTFOLIO_PAGE_SIZE, STAGE_LABELS, clampPage, emptyStateText, pageSlice,
  portfolioColumns, type PortfolioColumnKey, type PortfolioCompany, type PortfolioTab,
} from '@/lib/portfolio-table';
import { Pager } from '@/components/Pager';

const DASH = '—';

function dateCell(iso: string | null): string {
  return iso ? formatDateDisplay(iso.slice(0, 10)) : DASH;
}

function cell(key: PortfolioColumnKey, c: PortfolioCompany) {
  switch (key) {
    case 'company': return <span className="font-medium text-gray-900">{c.company_name}</span>;
    case 'website':
      return c.website
        ? <a href={c.website} target="_blank" rel="noreferrer" className="hover:underline">{c.domain ?? c.website}</a>
        : DASH;
    case 'geography': return c.country ?? DASH;
    case 'stage': return c.stage_at_entry ? STAGE_LABELS[c.stage_at_entry] ?? c.stage_at_entry : DASH;
    case 'sectors': return c.sectors.length ? c.sectors.join(', ') : DASH;
    case 'ticket': return c.ticket_eur != null ? formatTicketEur(c.ticket_eur) : DASH;
    case 'instrument': return c.instrument ? INSTRUMENT_LABELS[c.instrument] ?? c.instrument : DASH;
    case 'invested_on': return dateCell(c.invested_at);
    case 'exit_date': return dateCell(c.exit_at);
    case 'exit_type': return c.exit_type ? EXIT_TYPE_LABELS[c.exit_type] ?? c.exit_type : DASH;
    case 'contact': {
      const parts = [c.contact_name, c.contact_email, c.contact_phone].filter(Boolean);
      return parts.length ? parts.join(' · ') : DASH;
    }
  }
}

export function PortfolioTable({
  tab, companies, page, loading = false, confirmRemoveId, removeBusy = false,
  onPageChange, onEdit, onAskRemove, onConfirmRemove, onCancelRemove,
}: {
  tab: PortfolioTab;
  /** Every row of THIS tab, newest first — the table slices its own page. */
  companies: PortfolioCompany[];
  page: number;
  loading?: boolean;
  confirmRemoveId?: string | null;
  removeBusy?: boolean;
  onPageChange: (page: number) => void;
  onEdit: (id: string) => void;
  onAskRemove: (id: string) => void;
  onConfirmRemove: (id: string) => void;
  onCancelRemove: () => void;
}) {
  const columns = portfolioColumns(tab);
  const shown = pageSlice(companies, page);
  const effectivePage = clampPage(page, companies.length);
  // Company + the data columns + Invite + Edit + Remove.
  const colSpan = columns.length + 3;

  return (
    <div className="rounded-lg border border-gray-200 bg-white" data-testid={`portfolio-table-${tab}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-100 text-gray-500">
            <tr>
              {columns.map((col) => <th key={col.key} className="whitespace-nowrap px-3 py-2 font-medium">{col.label}</th>)}
              <th className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colSpan} className="px-3 py-4 text-gray-400">Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={colSpan} className="px-3 py-4 text-gray-400">{emptyStateText(tab)}</td></tr>
            ) : shown.map((c) => (
              <tr key={c.id} className="border-b border-gray-50 last:border-0" data-testid="portfolio-row">
                {columns.map((col) => <td key={col.key} className="px-3 py-2 text-gray-600">{cell(col.key, c)}</td>)}
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
      {!loading && <Pager page={effectivePage} total={companies.length} pageSize={PORTFOLIO_PAGE_SIZE} onChange={onPageChange} />}
    </div>
  );
}
