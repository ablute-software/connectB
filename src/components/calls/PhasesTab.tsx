'use client';
// Prompt 905 — Calls editor, tab "Phases" (spec §5.2): an ordered list. Add, rename, reorder (drag, or the
// arrows), delete; optional indicative dates. A simple call has a single phase. Distribution and evaluation per
// phase arrive with the next stage; here it is only the structure.
import { useState } from 'react';
import type { CallPhase } from '@/lib/calls/types';

export type PhaseDraft = Pick<CallPhase, 'id' | 'name' | 'startsOn' | 'endsOn'>;

const INPUT = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';

export const newPhaseId = (): string => globalThis.crypto.randomUUID();

export function PhasesTab({ phases, disabled, onChange }: { phases: PhaseDraft[]; disabled: boolean; onChange: (next: PhaseDraft[]) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= phases.length || from === to) return;
    const next = [...phases];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const patch = (id: string, p: Partial<PhaseDraft>) => onChange(phases.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <div className="max-w-2xl" data-testid="phases-tab">
      <p className="mb-4 text-sm text-gray-600">
        A call goes through its phases in order — for example <i>Document review → Pitch → Decision</i>. A simple call has just one.
        Moving to the next phase is always your decision, never automatic.
      </p>
      <ol className="space-y-2">
        {phases.map((p, i) => (
          <li key={p.id} draggable={!disabled}
            onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)}
            onDragOver={(e) => { if (dragId) e.preventDefault(); }}
            onDrop={() => { if (dragId) move(phases.findIndex((x) => x.id === dragId), i); setDragId(null); }}
            className={`rounded-lg border bg-white p-3 ${dragId === p.id ? 'border-[#0E7490] opacity-60' : 'border-gray-200'}`} data-testid="phase-row">
            <div className="flex items-center gap-2">
              <span className="cursor-grab select-none text-gray-300" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
              <span className="w-6 text-xs font-semibold text-gray-400">{i + 1}</span>
              <input aria-label={`Phase ${i + 1} name`} autoComplete="off" className={`${INPUT} min-w-0 flex-1`} value={p.name} disabled={disabled}
                maxLength={120} onChange={(e) => patch(p.id, { name: e.target.value })} />
              <button type="button" aria-label="Move up" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} className="rounded px-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30">↑</button>
              <button type="button" aria-label="Move down" disabled={disabled || i === phases.length - 1} onClick={() => move(i, i + 1)} className="rounded px-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30">↓</button>
              <button type="button" aria-label="Delete phase" disabled={disabled || phases.length <= 1}
                title={phases.length <= 1 ? 'A call needs at least one phase' : 'Delete phase'}
                onClick={() => onChange(phases.filter((x) => x.id !== p.id))} className="rounded px-1.5 text-gray-400 hover:text-[#B00000] disabled:opacity-30">✕</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-12 text-xs text-gray-500">
              <label>From <input type="date" autoComplete="off" className={INPUT} value={p.startsOn ?? ''} disabled={disabled} onChange={(e) => patch(p.id, { startsOn: e.target.value || null })} /></label>
              <label>to <input type="date" autoComplete="off" className={INPUT} value={p.endsOn ?? ''} disabled={disabled} onChange={(e) => patch(p.id, { endsOn: e.target.value || null })} /></label>
              <span className="text-gray-400">indicative dates, optional</span>
            </div>
            {p.startsOn && p.endsOn && p.endsOn < p.startsOn && <p role="alert" className="mt-1 pl-12 text-xs text-[#B00000]">This phase ends before it starts.</p>}
          </li>
        ))}
      </ol>
      <button type="button" disabled={disabled || phases.length >= 20} onClick={() => onChange([...phases, { id: newPhaseId(), name: `Phase ${phases.length + 1}`, startsOn: null, endsOn: null }])}
        className="mt-3 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
        + Add phase
      </button>
    </div>
  );
}
