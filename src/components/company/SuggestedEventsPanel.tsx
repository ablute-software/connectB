'use client';
// Prompt 359 Block D — "the app writes for you." Fetches whatever Watson
// already proposed from what the app knows (GET runs the AI pass itself if
// the knowledge changed, cached otherwise — see the route's own header) and
// offers each as a one-click Add/Ignore card. Cold-start framing (§D.3):
// with an empty roadmap this is the FIRST thing the founder sees here.
//
// Prompt 387 §D — the same pass also proposes up to 3 grounded QUESTIONS
// (kind='question'), shown only when there are no pending EVENT suggestions
// to prioritize — Nuno's own ordering. A question has no date; "Add as
// event" opens the SAME create popover the canvas's own "+ Add event"
// button does, pre-filled with the question's own title, rather than
// inserting a fabricated event with a guessed date.
import { useEffect, useState } from 'react';
import { GLASS_CARD, LABEL_CAPS } from './roadmap-visual';
import type { RoadmapEventStatus } from '@/lib/types';

interface Suggestion {
  id: string; kind: 'event' | 'question'; title: string; date: string | null; date_precision: string | null;
  category_label: string | null; reasoning: string | null;
}
interface ResolvedEvent {
  title: string; date: string; date_precision: string; status: RoadmapEventStatus; category_id: string | null; document_id: string | null;
}

export function SuggestedEventsPanel({ onAdd, onAddAsEvent }: {
  onAdd: (input: { title: string; date: string; end_date?: string | null; status: RoadmapEventStatus; category_id: string | null; document_id?: string | null; date_precision?: 'exact' | 'approx' | 'quarter' }) => void | Promise<void>;
  onAddAsEvent: (title: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Prompt 387 §C — a card that failed to respond puts itself back where it
  // was (not just at the end) and says why, right on the card — the exact
  // gap the network episode behind 386/387 exposed: a failed POST used to
  // leave everything looking unchanged, with no word about what happened.
  const [respondError, setRespondError] = useState<{ id: string; message: string } | null>(null);

  function load() {
    fetch('/api/roadmap/suggest-events').then((r) => r.json()).then((body) => {
      setSuggestions(body.available ? (body.suggestions ?? []) : []);
    }).catch(() => setSuggestions([]));
  }
  useEffect(load, []);

  // Prompt 387 §C.1 — optimistic AND honest: the card disappears the
  // instant Add/Dismiss is clicked (Nuno's own ask), restored with a
  // visible reason if the request actually fails — never a silent no-op,
  // never a card that lingers looking clickable while a slow request is
  // still in flight.
  async function respond(id: string, action: 'add' | 'ignore') {
    const index = (suggestions ?? []).findIndex((s) => s.id === id);
    const removed = index >= 0 ? suggestions![index] : null;
    setRespondError(null);
    setBusyId(id);
    setSuggestions((prev) => (prev ?? []).filter((s) => s.id !== id));
    try {
      const res = await fetch('/api/roadmap/suggest-events/respond', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }),
      });
      const body = await res.json().catch(() => null);
      if (!body?.ok) {
        if (removed) setSuggestions((prev) => { const next = [...(prev ?? [])]; next.splice(index, 0, removed); return next; });
        setRespondError({ id, message: body?.error ?? "Couldn't reach the server — check your connection and try again." });
        return;
      }
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
      // A question's own "add" response has no `event` — it hands back the
      // question's title so the caller can pre-fill the create popover;
      // the founder still supplies the actual date there.
      if (action === 'add' && body.question) {
        onAddAsEvent((body.question as { title: string }).title);
      }
      // Picks up whatever the server has left — a suggestion that's newly
      // pending shows up here for free; one already consumed never comes
      // back (the route's own `.eq('status', 'pending')`).
      load();
    } catch {
      if (removed) setSuggestions((prev) => { const next = [...(prev ?? [])]; next.splice(index, 0, removed); return next; });
      setRespondError({ id, message: "Couldn't reach the server — check your connection and try again." });
    } finally { setBusyId(null); }
  }

  if (suggestions === null || suggestions.length === 0) return null;

  const events = suggestions.filter((s) => s.kind !== 'question');
  // Prompt 387 §D.3 — priority to events; questions only show once there's
  // nothing else to act on.
  const questions = events.length === 0 ? suggestions.filter((s) => s.kind === 'question') : [];
  const shown = events.length > 0 ? events : questions;
  if (shown.length === 0) return null;

  // Prompt 385 §C.2 — full-width, 3-per-row grid (1-2 on narrow screens),
  // same data/actions (Add/Ignore, the real reasoning text) as before —
  // only the presentation moves from a stacked list to the mockup's card
  // grid, and the section itself moves to the bottom of the tab (the
  // caller's layout, not this component's).
  return (
    <div className={`${GLASS_CARD} p-6`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-[#131b2e]">{events.length > 0 ? 'Suggested events' : 'Questions worth answering'}</h3>
        <span className="text-xs text-[#434656]">
          {shown.length} found in your documents and profile
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((s) => (
          <div key={s.id} className="rounded-2xl border border-[#c3c5d9]/40 bg-white/50 p-3.5 transition-colors hover:border-[#0041c8]/30">
            <div className="mb-2 flex items-start justify-between gap-2">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0041c8]/10 text-[#0041c8]">
                {s.kind === 'question' ? '?' : '●'}
              </span>
              {s.category_label && (
                <span className={`${LABEL_CAPS} rounded bg-[#0041c8]/10 px-2 py-1 text-[#0041c8]`}>{s.category_label}</span>
              )}
            </div>
            <p className="text-sm font-semibold text-[#131b2e]">{s.title}</p>
            {s.date && <p className="mt-0.5 text-xs text-[#434656]">{s.date}</p>}
            {s.reasoning && <p className="mt-1.5 text-[11px] text-[#434656]/80">{s.reasoning}</p>}
            {respondError?.id === s.id && <p className="mt-1.5 text-[11px] text-[#ba1a1a]">{respondError.message}</p>}
            <div className="mt-3 flex gap-1.5">
              <button disabled={busyId === s.id} onClick={() => respond(s.id, 'add')}
                className="flex-1 rounded-lg bg-[#0041c8] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                {s.kind === 'question' ? '+ Add as event' : '+ Add to Roadmap'}
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
