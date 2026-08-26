'use client';
// Prompt 388 §C.1 / Prompt 390 §1 — Tabela 1 ("Relative importance"): one
// 0-10 value per scorecard criterion. Originally built inside
// EvaluationToolsPanel.tsx (where criteria are also CREATED/reordered) but
// that tab has nothing to do with a specific startup's dossier — the real
// destination per 388 §C.3 is the TOP of ScorecardPanel.tsx's own "Your
// scorecard" panel, above the read-only weighted table (Tabela 2). Extracted
// here, unchanged logic, so both places render the exact same component
// instead of two copies drifting apart over time.
//
// Prompt 393 §1 — feedback from real testers, via Nuno, discussed with the
// math on the table: dragging one criterion used to redistribute the
// change across the others to keep their SUM constant (388 §C.1's own
// design). That's gone. Each criterion's value is now fully independent —
// all of them can sit at 9 or 10 at once. The final weighted score
// (investor-scorecard-summary.ts, UNCHANGED) already normalizes by the
// REAL current sum — Σ(v×score)/Σv — so no redistribution logic is needed
// anywhere: adding a criterion dilutes the others automatically inside
// that one formula, and removing one un-dilutes them the same way. The
// alternative (weight as a fraction of a fixed max) was considered and
// rejected with Nuno — it would have needed the exact same real-sum
// normalization to make the final score sensible, making the fixed
// denominator pointless, or let the total score silently drift every time
// a criterion was added/removed.
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_NEW_CRITERION_WEIGHT } from '@/lib/investor-scorecard-weights';
import { TermHint } from '@/components/ui';

interface Criterion { id: string; label: string; weight: number; sort_order: number }

// Prompt 388 §C.1 — a horizontal drag bar per criterion. Local state
// updates on every pointer move for immediate visual feedback; the network
// write happens ONCE, on release — firing a write on every tick would be
// the exact "burst of concurrent writes" class of bug the roadmap drag
// gesture hit (Prompt 386). Prompt 393 §1 — no longer touches any OTHER
// criterion's value; onChange only ever updates this one.
function WeightBar({ criterion, disabled, onDragEnd, onChange }: {
  criterion: Criterion; disabled: boolean;
  onChange: (id: string, weight: number) => void;
  onDragEnd: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  function valueFromClientX(clientX: number): number {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(10, ratio * 10));
  }

  return (
    // Prompt 392 §1 — this row's fixed pieces (label + number, both
    // shrink-0) plus the ▲▼/Remove pieces around it in the <li> below were,
    // together, wider than the narrow (260px) left column actually had to
    // give — confirmed live: with no overflow-hidden backstop, the excess
    // painted over the START of the center column's own text instead of
    // wrapping or clipping. `min-w-0` on the track lets it actually shrink
    // (a flex item's default min-width is its own content size, not 0);
    // `w-14` (was `w-20`) + tighter gaps free up real room for it.
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="w-14 shrink-0 truncate text-sm text-gray-800" title={criterion.label}>{criterion.label}</span>
      <div ref={trackRef}
        className={`relative h-6 min-w-0 flex-1 rounded-full bg-gray-100 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-ew-resize'}`}
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setDragging(true);
          onChange(criterion.id, valueFromClientX(e.clientX));
        }}
        onPointerMove={(e) => { if (dragging) onChange(criterion.id, valueFromClientX(e.clientX)); }}
        onPointerUp={() => { if (dragging) { setDragging(false); onDragEnd(); } }}
        role="slider" aria-label={`Importance of ${criterion.label}`} aria-valuemin={0} aria-valuemax={10} aria-valuenow={criterion.weight}>
        <div className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[#0E7490]/70 transition-[width]"
          style={{ width: `${(criterion.weight / 10) * 100}%` }} />
      </div>
      <span className="w-5 shrink-0 text-right text-xs font-semibold text-gray-600">{criterion.weight}</span>
    </div>
  );
}

export function ScorecardWeightsEditor({ onChanged }: { onChanged?: () => void } = {}) {
  const [criteria, setCriteria] = useState<Criterion[] | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch('/api/portal/scorecard/criteria').then((r) => r.json()).then((d) => setCriteria(d.criteria ?? []));
  }
  useEffect(() => { load(); }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/portal/scorecard/criteria', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) { setError(data.error ?? 'Something went wrong — please try again.'); return; }
      load();
      onChanged?.();
    } finally { setBusy(false); }
  }

  async function addCriterion() {
    if (!newLabel.trim()) return;
    // A new criterion enters at the scale's own midpoint (5) — every
    // other criterion's own value is untouched (Prompt 393 §1: the final
    // score's own Σv denominator absorbs this automatically).
    await post({ action: 'create', label: newLabel.trim(), weight: DEFAULT_NEW_CRITERION_WEIGHT });
    setNewLabel('');
  }

  async function removeCriterion(id: string) {
    // Prompt 393 §1 — just delete it. No redistribution: the remaining
    // criteria keep exactly the values they already had, and the final
    // score's own Σ(v×score)/Σv formula un-dilutes them by itself.
    await post({ action: 'delete', id });
  }

  function move(index: number, dir: -1 | 1) {
    if (!criteria) return;
    const j = index + dir;
    if (j < 0 || j >= criteria.length) return;
    const order = criteria.map((c) => c.id);
    [order[index], order[j]] = [order[j], order[index]];
    void post({ action: 'reorder', order });
  }

  // Local-only during a drag: this ONE criterion's bar reflects the
  // pointer immediately, clamped to [0,10] — every other criterion's own
  // value is left completely alone (Prompt 393 §1). The server write is a
  // single batched call on release (handleDragEnd below), still using
  // update_weights (a map of one entry here is a valid, if trivial, case
  // of that same batch action — no new endpoint needed for this).
  function handleWeightChange(id: string, target: number) {
    const clamped = Math.max(0, Math.min(10, Math.round(target)));
    setCriteria((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, weight: clamped } : c)) : prev));
  }
  function handleDragEnd(id: string) {
    setCriteria((prev) => {
      const current = prev?.find((c) => c.id === id);
      if (current) {
        void fetch('/api/portal/scorecard/criteria', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'update_weights', weights: { [id]: current.weight } }),
        }).then(() => onChanged?.());
      }
      return prev;
    });
  }

  if (criteria === null) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Relative importance</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Each criterion moves on its own — set how much it matters to you, independently.
          </p>
        </div>
        <TermHint text="Each criterion's value is independent — raising one never lowers the others. Your final scorecard weighs every rating by these values, so a criterion set to 0 has no effect on your final score." />
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{error}</p>}

      {criteria.length === 0 ? (
        <p className="text-sm text-gray-400">No criteria yet — add your first one below.</p>
      ) : (
        <ul className="space-y-2">
          {criteria.map((c, i) => (
            // Prompt 392 §1 — overflow-hidden here is the hard backstop: even
            // if some future addition to this row misjudges its own width,
            // the excess clips inside this row's own box instead of ever
            // bleeding into whatever sits beside this column again.
            <li key={c.id} className="flex items-center gap-1.5 overflow-hidden rounded-lg border border-gray-200 bg-white p-1.5">
              <div className="flex shrink-0 flex-col">
                <button disabled={i === 0 || busy} onClick={() => move(i, -1)} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">▲</button>
                <button disabled={i === criteria.length - 1 || busy} onClick={() => move(i, 1)} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">▼</button>
              </div>
              <div className="min-w-0 flex-1">
                <WeightBar criterion={c} disabled={busy} onChange={handleWeightChange} onDragEnd={() => handleDragEnd(c.id)} />
              </div>
              <button disabled={busy} onClick={() => void removeCriterion(c.id)} aria-label={`Remove ${c.label}`} title="Remove"
                className="shrink-0 text-xs text-gray-400 hover:text-[#B00000] disabled:opacity-30">✕</button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2 rounded-lg border border-dashed border-gray-200 p-2.5">
        <label className="flex-1 text-xs text-gray-500">
          New criterion
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Team, Market size, Traction"
            onKeyDown={(e) => { if (e.key === 'Enter') void addCriterion(); }}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <button onClick={() => void addCriterion()} disabled={busy || !newLabel.trim()}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}
