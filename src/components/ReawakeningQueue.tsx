'use client';
// F — the Pipeline reawakening queue. Surfaces PENDING proposals the AI route
// produced when a canon fact was confirmed. Each cites the entity's prior "no"
// verbatim + the AI's one-line rationale (the delta), with the suggested
// wave/fit editable before approving. Approve → entity back to active + agenda
// task; reject → the pair stays evaluated, never re-proposed. No AI is called
// from here — this only resolves proposals that already exist.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, Tooltip } from '@/components/ui';
import type { FitScore } from '@/lib/types';

const FITS: FitScore[] = ['high', 'medium_high', 'medium', 'low'];
const FIT_LABEL: Record<FitScore, string> = { high: 'High', medium_high: 'Medium-high', medium: 'Medium', low: 'Low' };

export function ReawakeningQueue() {
  const { db, approveReawakening, rejectReawakening } = useStore();
  const [available, setAvailable] = useState(false);
  // Local per-proposal edits to wave/fit before approval (default = suggested).
  const [edits, setEdits] = useState<Record<string, { wave?: number; fit?: FitScore }>>({});

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => setAvailable(!!me.capabilities?.reawakening)).catch(() => {});
  }, []);

  const pending = useMemo(
    () => db.reawakeningProposals.filter((p) => p.status === 'pending' && p.reopens),
    [db.reawakeningProposals],
  );

  if (!available || pending.length === 0) return null;

  function editOf(id: string, suggestedWave?: number, suggestedFit?: FitScore) {
    const e = edits[id] ?? {};
    return { wave: e.wave ?? suggestedWave, fit: e.fit ?? suggestedFit };
  }
  function setEdit(id: string, patch: { wave?: number; fit?: FitScore }) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function approveOne(id: string, suggestedWave?: number, suggestedFit?: FitScore) {
    const { wave, fit } = editOf(id, suggestedWave, suggestedFit);
    approveReawakening(id, { wave, fit });
  }
  function approveAll() {
    for (const p of pending) approveReawakening(p.id, editOf(p.id, p.suggested_wave, p.suggested_fit));
  }

  return (
    <Card tint="amber"
      title={
        <span className="flex items-center gap-2">
          <span>↻ {pending.length} investidor{pending.length === 1 ? '' : 'es'} pode{pending.length === 1 ? '' : 'm'} renascer</span>
          <Tooltip text="Um facto confirmado da empresa pode ter mudado o porquê de um “não”. Reavalia — nada se move sem a tua aprovação.">
            <span className="cursor-help text-xs text-amber-600">?</span>
          </Tooltip>
        </span>
      }
      right={pending.length > 1 ? (
        <button onClick={approveAll} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0c637b]">
          Aprovar todos
        </button>
      ) : undefined}
    >
      <ul className="divide-y divide-amber-100/70">
        {pending.map((p) => {
          const entity = db.entities.find((e) => e.id === p.entity_id);
          const { wave, fit } = editOf(p.id, p.suggested_wave, p.suggested_fit);
          return (
            <li key={p.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{entity?.name ?? 'Investidor'}</span>
                {p.fact_statement && (
                  <span className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] text-gray-600">facto: {p.fact_statement}</span>
                )}
              </div>
              {p.prior_pass_reason && (
                <p className="mt-0.5 text-[12px] text-gray-500">
                  <span className="font-medium text-gray-600">“não” anterior:</span> {p.prior_pass_reason}
                  {p.prior_pass_category ? ` (${p.prior_pass_category})` : ''}
                </p>
              )}
              {p.rationale && <p className="mt-0.5 text-[12px] text-amber-800">{p.rationale}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <label className="text-[11px] text-gray-500">Wave
                  <input type="number" min={1} max={9} value={wave ?? ''} onChange={(e) => setEdit(p.id, { wave: e.target.value ? Number(e.target.value) : undefined })}
                    className="ml-1 w-12 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                </label>
                <label className="text-[11px] text-gray-500">Fit
                  <select value={fit ?? ''} onChange={(e) => setEdit(p.id, { fit: (e.target.value || undefined) as FitScore | undefined })}
                    className="ml-1 rounded border border-gray-300 px-1 py-0.5 text-xs">
                    <option value="">—</option>
                    {FITS.map((f) => <option key={f} value={f}>{FIT_LABEL[f]}</option>)}
                  </select>
                </label>
                <button onClick={() => approveOne(p.id, p.suggested_wave, p.suggested_fit)}
                  className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                  Reabrir
                </button>
                <button onClick={() => rejectReawakening(p.id)}
                  className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-white">
                  Ignorar
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
