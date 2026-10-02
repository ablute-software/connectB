'use client';
// Prompt AL758 — page controls for a client-side list. The pipeline's own
// pager is inline markup inside pipeline/page.tsx (numbered buttons per
// band), not a component anything else can reuse, and the back-office
// QueueTable's controls are welded to its URL state — so this is a small new
// component that borrows the pipeline's look (the #0E7490 active page,
// minimal grey buttons) instead of changing either of them. Previous / Next
// plus numbered pages plus "Page X of Y", and the total.
//
// Shows only the total when everything fits on one page — no controls for a
// page that is already the whole list, same rule the pipeline follows.
import { pageCount } from '@/lib/queue-table-state';

export function Pager({ page, total, pageSize, noun = 'companies', onChange }: {
  page: number; total: number; pageSize: number; noun?: string; onChange: (page: number) => void;
}) {
  const pages = pageCount(total, pageSize);
  const label = `${total} ${total === 1 ? noun.replace(/ies$/, 'y') : noun}`;
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
      <span data-testid="pager-total">{label}</span>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}
            className="rounded border border-gray-200 px-2 py-0.5 disabled:opacity-40">Previous</button>
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <button key={p} type="button" onClick={() => onChange(p)} aria-current={p === page ? 'page' : undefined}
              className={`min-w-[1.75rem] rounded px-2 py-1 font-medium ${
                p === page ? 'bg-[#0E7490] text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              {p}
            </button>
          ))}
          <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}
            className="rounded border border-gray-200 px-2 py-0.5 disabled:opacity-40">Next</button>
          <span className="ml-1" data-testid="pager-page">Page {page} of {pages}</span>
        </div>
      )}
    </div>
  );
}
