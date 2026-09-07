'use client';
// Prompt 570 §C — the shared list for every back-office review queue.
//
// There was nothing to reuse: twelve hand-rolled tables across the back-office,
// none with pagination, sorting or selection (checked before writing this, as
// the prompt asked). So this is new, and deliberately generic — 569 §7 wants
// the same sorting on Startups and Investors, and the remaining queues migrate
// to it in 572-574.
//
// It does not fetch. The page owns the query, because each queue's filters and
// joins are its own; this owns the state, the URL and the chrome. That split is
// what lets a queue keep its own endpoint while every queue behaves the same.
import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  parseQueueTableState, serializeQueueTableState, nextStateFor,
  rangeLabel, pageCount, toggleSort, PAGE_SIZES,
  type QueueTableState,
} from '@/lib/queue-table-state';

export interface QueueColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

export interface QueueTableProps<T> {
  columns: QueueColumn<T>[];
  rows: T[];
  total: number;
  getRowId: (row: T) => string;
  loading?: boolean;
  /** Rendered under a row when its chevron is open. Absent = not expandable. */
  renderExpanded?: (row: T) => ReactNode;
  /** Shown in the bulk bar; receives the ids selected across every page. */
  renderBulkActions?: (selectedIds: string[], clear: () => void) => ReactNode;
  /** Per-queue filter controls, rendered beside the shared toggles. */
  filterControls?: (state: QueueTableState, set: (patch: Partial<QueueTableState>) => void) => ReactNode;
  /** How many rows the "Hide internal" toggle is currently hiding. */
  hiddenInternalCount?: number;
  emptyMessage?: string;
  /** Prompt 572 §A — ReviewQueueLayout's own hook: a row click opens it in
   * the decision panel. Independent of renderExpanded's inline chevron
   * (a queue migrating to the panel pattern drops renderExpanded, it does
   * not combine the two) and of renderBulkActions' checkboxes (clicking a
   * row opens it; clicking its checkbox selects it, same as any list+
   * detail view). Omitted entirely, rows behave exactly as before. */
  onRowClick?: (row: T) => void;
  activeId?: string | null;
}

export function QueueTable<T>({
  columns, rows, total, getRowId, loading,
  renderExpanded, renderBulkActions, filterControls,
  hiddenInternalCount = 0, emptyMessage = 'Nothing to review.',
  onRowClick, activeId,
}: QueueTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const sortableKeys = useMemo(() => columns.filter((c) => c.sortable).map((c) => c.key), [columns]);
  const state = useMemo(
    () => parseQueueTableState(new URLSearchParams(params.toString()), { sortableKeys }),
    [params, sortableKeys],
  );

  const set = useCallback((patch: Partial<QueueTableState>) => {
    const next = nextStateFor(state, patch);
    const qs = serializeQueueTableState(next, new URLSearchParams(params.toString())).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [state, params, pathname, router]);

  // Selection lives here, not in the URL, and deliberately survives paging:
  // "12 selected across 2 pages" is only true if changing page does not drop
  // what page 1 selected.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const pageIds = rows.map(getRowId);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedElsewhere = [...selected].filter((id) => !pageIds.includes(id)).length;
  const pages = pageCount(total, state.pageSize);

  const toggleAllOnPage = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    return next;
  });

  return (
    <div className="flex flex-col gap-2">
      {/* Both toggles say what they are doing rather than doing it quietly. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={state.hideInternal}
            onChange={(e) => set({ hideInternal: e.target.checked })} />
          Hide internal
          {state.hideInternal && hiddenInternalCount > 0 && (
            // Never hide in silence: this count is the difference between
            // "there is no work" and "the work is ours".
            <span className="text-gray-400">· {hiddenInternalCount} hidden (internal)</span>
          )}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={state.showResolved}
            onChange={(e) => set({ showResolved: e.target.checked })} />
          Show resolved
        </label>
        {filterControls?.(state, set)}
      </div>

      {selected.size > 0 && renderBulkActions && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#0E7490]/30 bg-[#E8F4F8] px-3 py-2 text-xs">
          <span className="font-medium text-gray-800">
            {selected.size} selected
            {selectedElsewhere > 0 && ` across ${pages > 1 ? 'multiple pages' : 'this page'}`}
          </span>
          {renderBulkActions([...selected], () => setSelected(new Set()))}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-gray-500 hover:underline">
            Clear selection
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {/* Sticky so the columns stay readable at 100 rows a page. */}
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-400">
              {renderBulkActions && (
                <th className="w-8 py-1.5">
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage}
                    aria-label="Select all on this page" />
                </th>
              )}
              {renderExpanded && <th className="w-6" />}
              {columns.map((c) => (
                <th key={c.key} className={`py-1.5 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.sortable ? (
                    <button onClick={() => set(toggleSort(state, c.key))}
                      className="inline-flex items-center gap-1 hover:text-gray-700">
                      {c.label}
                      <span className={state.sort === c.key ? 'text-[#0E7490]' : 'text-gray-300'}>
                        {state.sort === c.key ? (state.dir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={columns.length + 2} className="py-6 text-center text-gray-400">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={columns.length + 2} className="py-6 text-center text-gray-400">{emptyMessage}</td></tr>
            )}
            {!loading && rows.map((row) => {
              const id = getRowId(row);
              return (
                <Fragment key={id}>
                  <tr className={`align-top ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''} ${activeId === id ? 'bg-[#E8F4F8]' : ''}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}>
                    {renderBulkActions && (
                      <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(id)}
                          aria-label="Select row"
                          onChange={() => setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(id)) next.delete(id); else next.add(id);
                            return next;
                          })} />
                      </td>
                    )}
                    {renderExpanded && (
                      <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setExpanded(expanded === id ? null : id)}
                          aria-label={expanded === id ? 'Collapse' : 'Expand'}
                          className="text-gray-400 hover:text-gray-700">
                          {expanded === id ? '▾' : '▸'}
                        </button>
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={`py-1.5 ${c.align === 'right' ? 'text-right' : ''}`}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                  {expanded === id && renderExpanded && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={columns.length + 2} className="px-2 py-2">{renderExpanded(row)}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span>{rangeLabel(state, total)}</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            Rows
            <select value={state.pageSize} onChange={(e) => set({ pageSize: Number(e.target.value) as never })}
              className="rounded border border-gray-200 px-1 py-0.5">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button disabled={state.page <= 1} onClick={() => set({ page: state.page - 1 })}
            className="rounded border border-gray-200 px-2 py-0.5 disabled:opacity-40">Previous</button>
          <span>{state.page} / {pages}</span>
          <button disabled={state.page >= pages} onClick={() => set({ page: state.page + 1 })}
            className="rounded border border-gray-200 px-2 py-0.5 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
