'use client';
// Prompt 359 Block D — "the app writes for you." Fetches whatever Watson
// already proposed from what the app knows (GET runs the AI pass itself if
// the knowledge changed, cached otherwise — see the route's own header) and
// offers each as a one-click Add/Ignore card. Cold-start framing (§D.3):
// with an empty roadmap this is the FIRST thing the founder sees here.
import { useEffect, useState } from 'react';
import { GLASS_CARD, LABEL_CAPS } from './roadmap-visual';
import type { RoadmapEventStatus } from '@/lib/types';

interface Suggestion {
  id: string; title: string; date: string; date_precision: string; category_label: string | null; reasoning: string | null;
}
interface ResolvedEvent {
  title: string; date: string; date_precision: string; status: RoadmapEventStatus; category_id: string | null; document_id: string | null;
}

export function SuggestedEventsPanel({ onAdd }: {
  onAdd: (input: { title: string; date: string; end_date?: string | null; status: RoadmapEventStatus; category_id: string | null; document_id?: string | null; date_precision?: 'exact' | 'approx' | 'quarter' }) => void | Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch('/api/roadmap/suggest-events').then((r) => r.json()).then((body) => {
      setSuggestions(body.available ? (body.suggestions ?? []) : []);
    }).catch(() => setSuggestions([]));
  }
  useEffect(load, []);

  async function respond(id: string, action: 'add' | 'ignore') {
    setBusyId(id);
    try {
      const res = await fetch('/api/roadmap/suggest-events/respond', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }),
      });
      const body = await res.json().catch(() => ({}));
      // The server only RESOLVES the suggestion (category label -> real
      // category_id) and marks it consumed — the actual row is created
      // here, via the same store action ("+") every manual add already
      // uses, so the canvas reflects it immediately without a page reload.
      if (action === 'add' && body.event) {
        const event = body.event as ResolvedEvent;
        await onAdd({
          title: event.title, date: event.date, status: event.status, category_id: event.category_id,
          document_id: event.document_id, date_precision: event.date_precision as 'exact' | 'approx' | 'quarter',
        });
      }
      load();
    } finally { setBusyId(null); }
  }

  if (suggestions === null || suggestions.length === 0) return null;

  // Prompt 385 §C.2 — full-width, 3-per-row grid (1-2 on narrow screens),
  // same data/actions (Add/Ignore, the real reasoning text) as before —
  // only the presentation moves from a stacked list to the mockup's card
  // grid, and the section itself moves to the bottom of the tab (the
  // caller's layout, not this component's).
  return (
    <div className={`${GLASS_CARD} p-6`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-[#131b2e]">Suggested events</h3>
        <span className="text-xs text-[#434656]">
          {suggestions.length} found in your documents and profile
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {suggestions.map((s) => (
          <div key={s.id} className="rounded-2xl border border-[#c3c5d9]/40 bg-white/50 p-3.5 transition-colors hover:border-[#0041c8]/30">
            <div className="mb-2 flex items-start justify-between gap-2">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0041c8]/10 text-[#0041c8]">●</span>
              {s.category_label && (
                <span className={`${LABEL_CAPS} rounded bg-[#0041c8]/10 px-2 py-1 text-[#0041c8]`}>{s.category_label}</span>
              )}
            </div>
            <p className="text-sm font-semibold text-[#131b2e]">{s.title}</p>
            <p className="mt-0.5 text-xs text-[#434656]">{s.date}</p>
            {s.reasoning && <p className="mt-1.5 text-[11px] text-[#434656]/80">{s.reasoning}</p>}
            <div className="mt-3 flex gap-1.5">
              <button disabled={busyId === s.id} onClick={() => respond(s.id, 'add')}
                className="flex-1 rounded-lg bg-[#0041c8] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                + Add to Roadmap
              </button>
              <button disabled={busyId === s.id} onClick={() => respond(s.id, 'ignore')}
                className="rounded-lg border border-[#c3c5d9] px-2.5 py-1.5 text-xs text-[#434656] hover:bg-white disabled:opacity-40">
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
