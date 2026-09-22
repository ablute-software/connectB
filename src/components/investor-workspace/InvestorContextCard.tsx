'use client';
// Prompt 715 Pedido C — "Current context": a temporary priority note, an
// optional pause on new discovery candidates, an optional analysis-
// capacity hint (registered for fase 4 only — no effect yet), and a date
// past which the whole card stops mattering on its own. Self-contained
// (own fetch/save), mounted inside InvestorProfilePanel's About tab —
// deliberately independent of that panel's own thesis-form state, since
// this card's fields have nothing to do with the mandate itself.
import { useEffect, useState } from 'react';

interface ContextResponse {
  linked: boolean;
  context: {
    priorityNote: string | null; pauseNewCandidates: boolean; capacity: 'few' | 'normal' | 'many' | null;
    expiresAt: string | null; expiryLabel: 'valid_until' | 'review_by' | null;
  } | null;
  expired: boolean;
}

export function InvestorContextCard() {
  const [data, setData] = useState<ContextResponse | null>(null);
  const [priorityNote, setPriorityNote] = useState('');
  const [pause, setPause] = useState(false);
  const [capacity, setCapacity] = useState<'few' | 'normal' | 'many' | ''>('');
  const [expiresAt, setExpiresAt] = useState('');
  const [expiryLabel, setExpiryLabel] = useState<'valid_until' | 'review_by'>('valid_until');
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const [expanded, setExpanded] = useState(false);

  function load() {
    fetch('/api/portal/investor-context').then((r) => r.json()).then((d: ContextResponse) => {
      setData(d);
      if (d.context) {
        setPriorityNote(d.context.priorityNote ?? '');
        setPause(d.context.pauseNewCandidates);
        setCapacity(d.context.capacity ?? '');
        setExpiresAt(d.context.expiresAt ? d.context.expiresAt.slice(0, 10) : '');
        setExpiryLabel(d.context.expiryLabel ?? 'valid_until');
        if (d.context.priorityNote || d.context.pauseNewCandidates || d.context.capacity || d.context.expiresAt) setExpanded(true);
      }
    }).catch(() => setData({ linked: false, context: null, expired: false }));
  }
  useEffect(load, []);

  async function save(patch?: { remove: true }) {
    setSaving(true); setSaveState('idle');
    try {
      const res = await fetch('/api/portal/investor-context', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch ?? {
          priorityNote: priorityNote.trim() || null, pauseNewCandidates: pause,
          capacity: capacity || null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          expiryLabel: expiresAt ? expiryLabel : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok !== false) {
        setSaveState('saved');
        if (patch?.remove) { setPriorityNote(''); setPause(false); setCapacity(''); setExpiresAt(''); setExpanded(false); }
        load();
      }
    } finally { setSaving(false); }
  }

  if (!data || !data.linked) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Current context</h3>
        {!expanded && (
          <button onClick={() => setExpanded(true)} className="text-xs font-medium text-[#0E7490] hover:underline">Set a temporary note</button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-gray-500">Optional and temporary — never shown to any startup, never changes your score today.</p>

      {data.expired && (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This context has expired — confirm it still applies, or remove it.
          <button onClick={() => save()} disabled={saving} className="ml-2 font-semibold underline">Confirm</button>
          <button onClick={() => save({ remove: true })} disabled={saving} className="ml-2 font-semibold underline">Remove</button>
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-medium text-gray-700">
            Priority right now (optional)
            <input autoComplete="off" value={priorityNote} onChange={(e) => setPriorityNote(e.target.value.slice(0, 280))} placeholder="e.g. Closing our current fund — reviewing slowly"
              className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900" />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
            <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} />
            Pause new candidates for now
          </label>
          <label className="block text-xs font-medium text-gray-700">
            Analysis capacity per wave (optional)
            <select value={capacity} onChange={(e) => setCapacity(e.target.value as 'few' | 'normal' | 'many' | '')}
              className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900">
              <option value="">Not set</option>
              <option value="few">Fewer than usual</option>
              <option value="normal">Normal</option>
              <option value="many">More than usual</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <label className="block text-xs font-medium text-gray-700">
              <span className="flex gap-2">
                <button type="button" onClick={() => setExpiryLabel('valid_until')} className={`rounded-full px-2 py-0.5 text-[11px] ${expiryLabel === 'valid_until' ? 'bg-[#E8F4F8] text-[#0E7490]' : 'text-gray-500'}`}>Valid until</button>
                <button type="button" onClick={() => setExpiryLabel('review_by')} className={`rounded-full px-2 py-0.5 text-[11px] ${expiryLabel === 'review_by' ? 'bg-[#E8F4F8] text-[#0E7490]' : 'text-gray-500'}`}>Revisit on</button>
              </span>
              <input autoComplete="off" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900" />
            </label>
          </div>
          <p className="text-[11px] text-gray-400">Never extends itself — once the date passes, this stops applying until you set it again.</p>
          <div className="flex items-center gap-2">
            <button onClick={() => save()} disabled={saving} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => save({ remove: true })} disabled={saving} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              Remove
            </button>
            {saveState === 'saved' && <span className="text-xs text-gray-400">Saved</span>}
          </div>
        </div>
      )}
    </div>
  );
}
