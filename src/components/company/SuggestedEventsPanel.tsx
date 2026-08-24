'use client';
// Prompt 359 Block D — "the app writes for you." Fetches whatever Watson
// already proposed from what the app knows (GET runs the AI pass itself if
// the knowledge changed, cached otherwise — see the route's own header) and
// offers each as a one-click Add/Ignore card. Cold-start framing (§D.3):
// with an empty roadmap this is the FIRST thing the founder sees here.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
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

  return (
    <Card title={<span className="text-[#0E7490]">Suggested events</span>}>
      <p className="mb-2 text-xs text-gray-500">
        We found {suggestions.length} event{suggestions.length === 1 ? '' : 's'} in your documents and profile — add them?
      </p>
      <div className="space-y-2">
        {suggestions.map((s) => (
          <div key={s.id} className="flex items-start justify-between gap-2 rounded-lg border border-gray-200 p-2.5">
            <div className="min-w-0">
              <p className="text-sm text-gray-800">{s.title}</p>
              <p className="text-xs text-gray-400">{s.date}{s.category_label ? ` · ${s.category_label}` : ''}</p>
              {s.reasoning && <p className="mt-0.5 text-[11px] text-gray-400">{s.reasoning}</p>}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button disabled={busyId === s.id} onClick={() => respond(s.id, 'add')}
                className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                Add ✓
              </button>
              <button disabled={busyId === s.id} onClick={() => respond(s.id, 'ignore')}
                className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                Ignore
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
