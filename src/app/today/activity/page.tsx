'use client';
// Prompt 884 — the Recent activity card's "View all activity →" link needs
// a real destination, not a dead one: every event buildRecentActivity()
// can produce, paginated, newest first. Reuses the same URL-state
// (page/pageSize) infra the back-office account tables already use
// (queue-table-state.ts / use-table-url-state.ts) — client-side slice over
// an already-loaded array, same shape as those pages.
import { Suspense, useMemo } from 'react';
import { Card, EntityLink } from '@/components/ui';
import { useStore } from '@/lib/store';
import { buildRecentActivity, formatActivityTime } from '@/lib/recent-activity';
import { useTableUrlState } from '@/lib/use-table-url-state';
import { PAGE_SIZES, type PageSize } from '@/lib/queue-table-state';

// useTableUrlState reads useSearchParams(), which Next.js requires a
// Suspense boundary around in the app router (same pattern
// backoffice/investors/page.tsx already uses) — otherwise the page fails to
// prerender (missing-suspense-with-csr-bailout), exactly the build failure
// class CLAUDE.md's own rule 5 warns never to miss by trusting a grep.
export default function ActivityPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Loading…</p>}>
      <ActivityPageContent />
    </Suspense>
  );
}

function ActivityPageContent() {
  const { db } = useStore();
  const [tableState, setTableState] = useTableUrlState();
  const now = new Date();
  const events = useMemo(() => buildRecentActivity(db), [db]);
  const page = Math.max(1, tableState.page);
  const pageCount = Math.max(1, Math.ceil(events.length / tableState.pageSize));
  const pageEvents = events.slice((page - 1) * tableState.pageSize, page * tableState.pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-1.5">
        <h1 className="text-lg font-bold">Recent activity</h1>
        <span className="text-sm text-gray-500">{events.length} event(s)</span>
      </div>
      <Card>
        {pageEvents.length === 0 ? <p className="text-sm text-gray-400">No activity yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {pageEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                {e.entityId ? <EntityLink id={e.entityId}>{e.label}</EntityLink> : <span>{e.label}</span>}
                <span className="shrink-0 text-xs text-gray-400">{formatActivityTime(e.occurredAt, now)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <select value={tableState.pageSize} onChange={(e) => setTableState({ pageSize: Number(e.target.value) as PageSize, page: 1 })}
              className="rounded border border-gray-300 px-1.5 py-0.5">
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setTableState({ page: page - 1 })}
              className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40">Previous</button>
            <span>Page {page} of {pageCount}</span>
            <button disabled={page >= pageCount} onClick={() => setTableState({ page: page + 1 })}
              className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40">Next</button>
          </div>
        </div>
      </Card>
    </div>
  );
}
