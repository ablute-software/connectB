'use client';
// Investor Workspace Agenda (prompt 59) — merged timeline of meetings, round
// deadlines, and manual follow-ups. iCal export deliberately NOT built this
// pass — a read-only subscription feed needs a stable per-investor secret
// token (generation, storage, revocation) to avoid leaking calendar data to
// anyone who guesses a URL, which isn't the "cheap to do now" case the
// prompt allows skipping; registered for Prompt 61 instead.
import { useEffect, useState } from 'react';

interface AgendaItem {
  kind: 'meeting' | 'round_close' | 'follow_up';
  date: string; orgId: string; orgName: string; title: string; followupId?: string;
}

const KIND_ICON: Record<AgendaItem['kind'], string> = { meeting: '◔', round_close: '⏱', follow_up: '⚑' };

export function InvestorAgendaPanel() {
  const [items, setItems] = useState<AgendaItem[] | null>(null);

  function load() {
    fetch('/api/portal/agenda').then((r) => r.json()).then((d) => setItems(d.items ?? []));
  }
  useEffect(load, []);

  async function markDone(id: string) {
    await fetch('/api/portal/agenda', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  }

  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;
  if (items.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">Nothing scheduled yet.</p>
      </div>
    );
  }

  const now = new Date();
  return (
    <div className="max-w-2xl space-y-2">
      <h1 className="text-lg font-bold text-gray-900">Agenda</h1>
      {items.map((it, i) => {
        const isPast = new Date(it.date) < now;
        return (
          <div key={`${it.kind}-${it.followupId ?? i}`} className={`flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 ${isPast ? 'opacity-60' : ''}`}>
            <span className="text-lg">{KIND_ICON[it.kind]}</span>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">{it.title}</div>
              <div className="text-xs text-gray-400">{new Date(it.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
            </div>
            {it.kind === 'follow_up' && it.followupId && (
              <button onClick={() => markDone(it.followupId!)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:border-[#0E7490]">
                Done
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
