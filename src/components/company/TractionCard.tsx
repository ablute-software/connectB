'use client';
// Investor Workspace Fase 1 (prompt 54) — Zona 1 traction metrics. Founder
// picks 3-5 label+value pairs ("MRR" / "€12k") that show on the investor
// portal snapshot card. Same add/edit/remove pattern as StartupTeamCard.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import type { TractionMetric } from '@/lib/types';

const BLANK = { label: '', value: '' };
const MAX_METRICS = 5;

export function TractionCard({ canEdit }: { canEdit: boolean }) {
  const { db, addTractionMetric, updateTractionMetric, removeTractionMetric } = useStore();
  const metrics = db.tractionMetrics;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(BLANK);

  function submitAdd() {
    if (!draft.label.trim() || !draft.value.trim()) return;
    addTractionMetric({ label: draft.label.trim(), value: draft.value.trim() });
    setDraft(BLANK); setAdding(false);
  }

  function startEdit(m: TractionMetric) {
    setEditDraft({ label: m.label, value: m.value });
    setEditingId(m.id);
  }
  function saveEdit(id: string) {
    if (!editDraft.label.trim() || !editDraft.value.trim()) return;
    updateTractionMetric(id, { label: editDraft.label.trim(), value: editDraft.value.trim() });
    setEditingId(null);
  }

  const atLimit = metrics.length >= MAX_METRICS;

  return (
    <Card title="Traction metrics" right={canEdit && !adding && !atLimit ? <button onClick={() => setAdding(true)} className="text-xs text-cyan-700 hover:underline">+ Add metric</button> : undefined}>
      <p className="mb-2 text-xs text-gray-400">Pick 3-5 numbers that tell the story — these show on the investor snapshot card, in the order added.</p>
      {metrics.length === 0 && !adding ? (
        <p className="text-sm text-gray-400">No traction metrics yet.</p>
      ) : (
        <ul className="space-y-2">
          {metrics.map((m) => (
            <li key={m.id} className="rounded-lg border border-gray-100 p-2.5 text-sm">
              {editingId === m.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input value={editDraft.label} onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })} placeholder="Label (e.g. MRR)" className="rounded border border-gray-300 px-2 py-1 text-sm" />
                    <input value={editDraft.value} onChange={(e) => setEditDraft({ ...editDraft, value: e.target.value })} placeholder="Value (e.g. €12k)" className="rounded border border-gray-300 px-2 py-1 text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(m.id)} className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white">Save</button>
                    <button onClick={() => setEditingId(null)} className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div><span className="text-xs text-gray-500">{m.label}</span><div className="font-medium text-gray-900">{m.value}</div></div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-2 text-xs">
                      <button onClick={() => startEdit(m)} className="text-gray-400 hover:text-gray-700">Edit</button>
                      <button onClick={() => removeTractionMetric(m.id)} className="text-gray-400 hover:text-[#B00000]">Remove</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-3 space-y-2 rounded-lg border border-cyan-100 bg-cyan-50/40 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Label (e.g. MRR)" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} placeholder="Value (e.g. €12k)" className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <div className="flex gap-2">
            <button disabled={!draft.label.trim() || !draft.value.trim()} onClick={submitAdd} className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white disabled:opacity-40">Add</button>
            <button onClick={() => { setAdding(false); setDraft(BLANK); }} className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
          </div>
        </div>
      )}
      {atLimit && !adding && <p className="mt-2 text-xs text-gray-400">Up to {MAX_METRICS} metrics — remove one to add another.</p>}
    </Card>
  );
}
