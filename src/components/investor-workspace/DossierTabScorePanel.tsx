'use client';
// Prompt 388 §C.2 — "A minha avaliação": one instance per dossier tab
// (About/SWOT/Roadmap/Clarifications/Round/Market/Team), scoring the SAME
// criteria investor_scorecard_criteria already defines, independently per
// tab. Nuno's own words: "se damos 5 a tecnologia em swot, ao passar para
// roadmap está a zero e pode levar um 6 ou 9" — never pre-filled from
// another tab, never a stored 0 for "not rated here yet."
import { useEffect, useState } from 'react';
import { TermHint } from '@/components/ui';

export type DossierScoreTab = 'about' | 'swot' | 'roadmap' | 'clarifications' | 'round' | 'market' | 'team';

interface TabScoreItem { criteriaId: string; label: string; weight: number; score: number | null; note: string | null }

const HELP_TEXT = 'Weight is relative importance, not a score. Each dossier tab has its own independent rating for the same '
  + 'criteria — scoring Technology here doesn\'t carry over to another tab. A criterion you never rate on a tab is simply left '
  + 'out of that tab\'s average, not counted as a 0.';

export function DossierTabScorePanel({ orgId, tab }: { orgId: string; tab: DossierScoreTab }) {
  const [items, setItems] = useState<TabScoreItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch(`/api/portal/scorecard/tab-scores?orgId=${encodeURIComponent(orgId)}&tab=${tab}`)
      .then((r) => r.json()).then((d) => setItems(d.items ?? [])).catch(() => setItems([]));
  }
  useEffect(load, [orgId, tab]);

  async function setScore(criteriaId: string, score: number) {
    setBusyId(criteriaId); setError(null);
    // Optimistic — same discipline as 387 §C's suggested-events fix:
    // reflect the click immediately, roll back with a visible reason if
    // the write actually fails, never a silent no-op.
    const prevItems = items;
    setItems((prev) => (prev ?? []).map((it) => (it.criteriaId === criteriaId ? { ...it, score } : it)));
    try {
      const res = await fetch('/api/portal/scorecard/tab-scores', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ criteriaId, orgId, tab, score }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) { setItems(prevItems); setError(data.error ?? 'Could not save — try again.'); return; }
    } catch {
      setItems(prevItems);
      setError("Couldn't reach the server — check your connection and try again.");
    } finally { setBusyId(null); }
  }

  // No criteria defined at all yet — nothing to show here (same "don't
  // render an empty box" discipline ScorecardPanel.tsx already follows).
  if (items === null || items.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-gray-700">My evaluation</h3>
        <TermHint text={HELP_TEXT} />
      </div>
      {/* §C.4 — repeated on every instance, not just once on the main
          scorecard panel. */}
      <p className="mt-0.5 text-[11px] text-gray-400">Private to you — never shown to the startup.</p>
      {error && <p className="mt-1.5 rounded-lg bg-red-50 px-2 py-1 text-[11px] text-[#B00000]">{error}</p>}
      <ul className="mt-2 space-y-2">
        {items.map((it) => (
          <li key={it.criteriaId} className="text-xs">
            <span className="text-gray-700">{it.label}</span>
            <div className="mt-1 flex flex-wrap gap-0.5" role="group" aria-label={`Score for ${it.label} on this tab`}>
              {Array.from({ length: 11 }, (_, n) => n).map((n) => (
                <button key={n} disabled={busyId === it.criteriaId} onClick={() => void setScore(it.criteriaId, n)} title={String(n)}
                  className={`h-5 w-5 rounded text-[10px] font-medium ${
                    it.score === n ? 'bg-[#0E7490] text-white' : 'bg-white text-gray-500 hover:bg-gray-200'
                  } disabled:opacity-40`}>
                  {n}
                </button>
              ))}
              {it.score == null && <span className="ml-1 self-center text-[10px] text-gray-400">not rated here</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
