'use client';
// Investor Workspace Agenda (prompt 59) — merged timeline of meetings, round
// deadlines, and manual follow-ups. Prompt 83 Bloco 5 — iCal export, the one
// documented omission. This is a session-gated snapshot download (Export
// .ics button, same security model as the Pipeline/Archive CSV export), not
// a webcal:// subscription feed: a live feed needs a stable per-investor
// secret token (generation/storage/revocation), which is a real schema
// change and stays a separate, unbuilt proposal.
//
// Prompt 144 §5 — absorbed InvestorTodayPanel's action-item list as a
// "Needs attention" section above the meeting/deadline timeline. Still two
// separate fetches against the two original endpoints (/api/portal/agenda,
// /api/portal/today) — neither endpoint changed, only the UI merged. The one
// item dropped on purpose: Today's own `meeting_today` entries, since the
// timeline below already lists every meeting, today's included.
import { useEffect, useState } from 'react';

interface AgendaItem {
  kind: 'meeting' | 'round_close' | 'follow_up';
  date: string; orgId: string; orgName: string; title: string; followupId?: string;
}

interface TodayItem { kind: string; title: string; orgId?: string }

const KIND_ICON: Record<AgendaItem['kind'], string> = { meeting: '◔', round_close: '⏱', follow_up: '⚑' };

const TODAY_KIND_STYLE: Record<string, string> = {
  new_matches: 'text-[#0E7490]', qa_answered: 'text-green-700',
  round_closing: 'text-amber-700', followup_overdue: 'text-[#B00000]',
};

export function InvestorAgendaPanel() {
  const [items, setItems] = useState<AgendaItem[] | null>(null);
  const [todayItems, setTodayItems] = useState<TodayItem[] | null>(null);

  function load() {
    fetch('/api/portal/agenda').then((r) => r.json()).then((d) => setItems(d.items ?? []));
    fetch('/api/portal/today').then((r) => r.json()).then((d) => setTodayItems((d.items ?? []).filter((it: TodayItem) => it.kind !== 'meeting_today')));
  }
  useEffect(load, []);

  async function markDone(id: string) {
    await fetch('/api/portal/agenda', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  }

  if (!items || !todayItems) return <p className="text-sm text-gray-400">Loading…</p>;
  if (items.length === 0 && todayItems.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">No meetings yet — express interest on a startup to start a conversation.</p>
        <p className="mt-1 text-xs text-gray-400">Round deadlines and reminders you set from a Pipeline card show up here too.</p>
      </div>
    );
  }

  const now = new Date();
  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Agenda</h1>
        <a
          href="/api/portal/agenda/ical"
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:border-[#0E7490]"
        >
          Export .ics
        </a>
      </div>

      {todayItems.length > 0 && (
        <div className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Needs attention</h2>
          {todayItems.map((it, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
              <span className={`text-sm font-medium ${TODAY_KIND_STYLE[it.kind] ?? 'text-gray-900'}`}>{it.title}</span>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {todayItems.length > 0 && <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Meetings & deadlines</h2>}
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
      )}
    </div>
  );
}
