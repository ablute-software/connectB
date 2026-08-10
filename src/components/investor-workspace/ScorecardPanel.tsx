'use client';
// Prompt 142 Bloco 1 — score THIS startup against the criteria the
// investor already defined (EvaluationToolsPanel's "Scorecard criteria"
// tab). Private judgment, not startup-disclosed data — shown regardless of
// disclosure level, since it's about what the investor thinks, not what
// the startup has shared.
import { useEffect, useState } from 'react';

interface ScoreItem { criteriaId: string; label: string; weight: number; score: number | null; note: string | null }

export function ScorecardPanel({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<ScoreItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch(`/api/portal/scorecard/scores?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => setItems(d.items ?? []));
  }
  useEffect(() => { load(); }, [orgId]);

  async function setScore(criteriaId: string, score: number) {
    setBusyId(criteriaId); setError(null);
    try {
      const res = await fetch('/api/portal/scorecard/scores', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ criteriaId, orgId, score }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) { setError(data.error ?? 'Could not save — try again.'); return; }
      load();
    } finally { setBusyId(null); }
  }

  if (items === null || items.length === 0) return null; // no criteria defined yet — nothing to show here

  const scored = items.filter((i) => i.score != null);
  const totalWeight = scored.reduce((s, i) => s + i.weight, 0);
  const weightedAvg = totalWeight > 0
    ? scored.reduce((s, i) => s + i.weight * (i.score as number), 0) / totalWeight
    : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Your scorecard</h2>
        {weightedAvg != null && <span className="text-sm font-semibold text-[#0E7490]">{weightedAvg.toFixed(1)} / 10</span>}
      </div>
      <p className="mt-0.5 text-xs text-gray-400">Private to you — never shown to the startup.</p>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-[#B00000]">{error}</p>}
      <ul className="mt-2 space-y-2">
        {items.map((it) => (
          <li key={it.criteriaId} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-gray-700">{it.label}</span>
            <div className="flex gap-0.5" role="group" aria-label={`Score for ${it.label}`}>
              {Array.from({ length: 11 }, (_, n) => n).map((n) => (
                <button key={n} disabled={busyId === it.criteriaId} onClick={() => setScore(it.criteriaId, n)}
                  title={String(n)}
                  className={`h-5 w-5 rounded text-[10px] font-medium ${
                    it.score === n ? 'bg-[#0E7490] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  } disabled:opacity-40`}>
                  {n}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
