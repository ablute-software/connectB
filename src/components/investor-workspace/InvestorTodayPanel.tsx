'use client';
// Investor Workspace Today (prompt 59) — generated, not hand-written. See
// /api/portal/today's header for why nothing at the function level is
// shared with the founder's own TodayPanel.tsx (different data domain).
import { useEffect, useState } from 'react';

interface TodayItem { kind: string; title: string; orgId?: string }

const KIND_STYLE: Record<string, string> = {
  new_matches: 'text-[#0E7490]', qa_answered: 'text-green-700', meeting_today: 'text-purple-700',
  round_closing: 'text-amber-700', followup_overdue: 'text-[#B00000]',
};

export function InvestorTodayPanel() {
  const [items, setItems] = useState<TodayItem[] | null>(null);

  useEffect(() => {
    fetch('/api/portal/today').then((r) => r.json()).then((d) => setItems(d.items ?? []));
  }, []);

  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Today</h1>
        <span className="text-sm text-gray-500">{new Date().toISOString().slice(0, 10)}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing needs your attention today.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
              <span className={`text-sm font-medium ${KIND_STYLE[it.kind] ?? 'text-gray-900'}`}>{it.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
