'use client';
// Overnight block Task B2 — fast triage for imported historical interactions
// flagged needs_review (the file's own header warned that positive/green
// markings were lost in its export, so every uncolored "—" interaction was
// staged with needs_review=true for a human to confirm the real outcome).
// Keyboard-first: j/k move, 1/2/3 classify as a positive outcome + clear the
// flag, r clears the flag without reclassifying (confirms "no signal here").
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, EntityLink, PersonLink, Tooltip } from '@/components/ui';
import type { Classification } from '@/lib/types';

const CLASSIFY_KEYS: { key: string; classification: Classification; label: string }[] = [
  { key: '1', classification: 'interested', label: 'Interested' },
  { key: '2', classification: 'meeting_request', label: 'Meeting request' },
  { key: '3', classification: 'question', label: 'Question' },
];

export default function NeedsReviewPage() {
  const { db, classifyInteraction, clearNeedsReview } = useStore();
  const queue = useMemo(() => db.interactions.filter((i) => i.needs_review)
    .sort((a, b) => {
      const ea = db.entities.find((e) => e.id === a.entity_id)?.name ?? '';
      const eb = db.entities.find((e) => e.id === b.entity_id)?.name ?? '';
      return ea.localeCompare(eb) || a.occurred_at.localeCompare(b.occurred_at);
    }), [db.interactions, db.entities]);

  const [index, setIndex] = useState(0);
  // Explicit counter, not derived from queue shrinkage — the demo store
  // hydrates from localStorage asynchronously after first mount, so a
  // lazy-init snapshot of the queue length taken at mount can race that and
  // capture a stale (often zero) count.
  const [reviewedCount, setReviewedCount] = useState(0);

  useEffect(() => {
    if (index >= queue.length && queue.length > 0) setIndex(queue.length - 1);
  }, [queue.length, index]);

  const current = queue[index];

  // No explicit "advance" needed: clearing an item shrinks the queue, the
  // next item slides into this same index, and the bounds-clamping effect
  // below handles the case where we were sitting on the last one.
  function classify(classification: Classification) {
    if (!current) return;
    classifyInteraction(current.id, classification);
    clearNeedsReview(current.id);
    setReviewedCount((c) => c + 1);
  }

  function confirmNoSignal() {
    if (!current) return;
    clearNeedsReview(current.id);
    setReviewedCount((c) => c + 1);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!current) return;
      if (e.key === 'j') { setIndex((i) => Math.min(i + 1, queue.length - 1)); }
      else if (e.key === 'k') { setIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === 'r') { confirmNoSignal(); }
      else {
        const hit = CLASSIFY_KEYS.find((c) => c.key === e.key);
        if (hit) classify(hit.classification);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, queue.length]);

  if (queue.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Needs review</h1>
        <Card><p className="text-sm text-gray-400">Queue clear — every imported interaction has been confirmed.</p></Card>
      </div>
    );
  }

  const entity = current ? db.entities.find((e) => e.id === current.entity_id) : undefined;
  const person = current?.person_id ? db.people.find((p) => p.id === current.person_id) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Needs review</h1>
        <span className="text-sm text-gray-500">{reviewedCount} reviewed · {queue.length} left</span>
      </div>
      <p className="text-xs text-gray-400">
        These came from imported history whose original outcome coloring was lost — confirm what actually happened.
        Keyboard: <b>j</b>/<b>k</b> next/prev · <b>1</b> interested · <b>2</b> meeting request · <b>3</b> question · <b>r</b> no real signal (clear only).
      </p>

      {current && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {entity && <EntityLink id={entity.id}><span className="font-semibold">{entity.name}</span></EntityLink>}
            {person && <PersonLink id={person.id}><span className="text-gray-500">· {person.full_name}</span></PersonLink>}
            <span className="ml-auto text-xs text-gray-400">{current.occurred_at.slice(0, 10)} · {current.channel.replace('_', ' ')} · {current.direction === 'out' ? 'outbound' : 'inbound'}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{current.content}</p>
          <div className="mt-2 text-xs text-gray-400">Current classification: {current.classification ?? '—'}</div>

          <div className="mt-4 flex flex-wrap gap-2">
            {CLASSIFY_KEYS.map((c) => (
              <Tooltip key={c.key} text={`Reclassify as ${c.label.toLowerCase()} and clear the review flag. (key: ${c.key})`}>
                <button onClick={() => classify(c.classification)}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">
                  {c.key} · {c.label}
                </button>
              </Tooltip>
            ))}
            <Tooltip text="Leaves the classification as-is — just confirms there was no positive signal here. (key: r)">
              <button onClick={confirmNoSignal} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                r · No real signal
              </button>
            </Tooltip>
            <div className="ml-auto flex gap-2">
              <button onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40">k · Prev</button>
              <button onClick={() => setIndex((i) => Math.min(i + 1, queue.length - 1))} disabled={index >= queue.length - 1}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40">j · Next</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
