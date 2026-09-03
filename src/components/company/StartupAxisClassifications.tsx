'use client';
// Prompt 251/253 Bloco C — the startup's own confirmed position on a
// free-text rejection axis (org_axis_classifications, schema from Bloc A,
// first writer here). Structured axes (stage/sector/geography) read live
// org/entity fields instead and never need this — only axes founders have
// actually coded a rejection against (rejection-code-match.ts's default
// branch) show up here, so the list only ever contains axes that matter
// right now, never an invented taxonomy to fill in ahead of use.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { isStructuredAxis } from '@/lib/rejection-code-match';

export function StartupAxisClassifications() {
  const { db, addOrgAxisClassification } = useStore();
  const [openAxis, setOpenAxis] = useState<string | null>(null);
  const [level, setLevel] = useState('');
  const [label, setLabel] = useState('');

  const axisCodes = [...new Set(db.rejectionCodes.map((c) => c.axis_code).filter((a) => !isStructuredAxis(a)))].sort();
  if (axisCodes.length === 0) return null;

  function latestFor(axis: string) {
    return db.orgAxisClassifications.filter((c) => c.axis_code === axis)
      .sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at)).at(-1);
  }

  function openFor(axis: string) {
    setOpenAxis(axis); setLevel(''); setLabel('');
  }

  function save(axis: string) {
    const n = Number(level);
    if (!label.trim() || !Number.isFinite(n)) return;
    addOrgAxisClassification({ axis_code: axis, level: n, level_label: label.trim() });
    setOpenAxis(null); setLevel(''); setLabel('');
  }

  return (
    <Card title="Startup axis classifications">
      <p className="mb-2 text-xs text-gray-500">
        Axes an investor has coded a rejection against — confirm where the startup stands today, and a cleared bar
        gets detected automatically (no need to remember to revisit it).
      </p>
      <ul className="space-y-2">
        {axisCodes.map((axis) => {
          const latest = latestFor(axis);
          const editing = openAxis === axis;
          return (
            <li key={axis} className="rounded border border-gray-200 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{axis}</span>
                {latest ? (
                  <span className="text-xs text-gray-500">level {latest.level} — {latest.level_label} · {latest.confirmed_at.slice(0, 10)}</span>
                ) : (
                  <span className="text-xs text-amber-700">not confirmed yet</span>
                )}
                <button onClick={() => (editing ? setOpenAxis(null) : openFor(axis))}
                  className="ml-auto text-xs font-medium text-cyan-700 hover:underline">
                  {editing ? 'Cancel' : latest ? 'Update' : 'Confirm'}
                </button>
              </div>
              {editing && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <input autoComplete="off" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="level (number)" inputMode="numeric"
                    className="w-24 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                  <input autoComplete="off" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="what this level means"
                    className="flex-1 min-w-[160px] rounded border border-gray-300 px-1.5 py-1 text-xs" />
                  <button disabled={!label.trim() || level.trim() === ''} onClick={() => save(axis)}
                    className="rounded bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                    Save
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
