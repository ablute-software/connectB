'use client';
// Prompt 917 (Adenda 1, Part B) — back office, Calls: how the import from documents is doing, and the corrections people make most.
import { useEffect, useState } from 'react';
import type { CorrectionsSummary } from '@/lib/calls/ai-import/corrections';

interface Data { available: boolean; corrections?: CorrectionsSummary; runs?: { total: number; byMode: Record<string, number>; avgCoverage: number | null; avgTypeConfidence: number | null; avgDurationMs: number | null } }
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const LABEL: Record<string, string> = { field_deleted: 'Question deleted', kind_changed: 'Kind changed', label_changed: 'Label edited', required_changed: 'Required changed', options_changed: 'Options edited' };

export function ImportCorrectionsPanel() {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/backoffice/calls-import-corrections', { cache: 'no-store' }).then((r) => r.json()).then((x) => { if (alive) setD(x?.ok ? x : { available: false }); }).catch(() => { if (alive) setD({ available: false }); });
    return () => { alive = false; };
  }, []);
  if (!d) return null;
  if (!d.available || !d.runs || !d.corrections) return null;
  const { runs, corrections: c } = d;
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="import-corrections" aria-label="Import from documents">
      <h2 className="text-sm font-semibold text-gray-900">Import from documents</h2>
      <p className="mt-0.5 text-xs text-gray-500">How the proposals were made, and what people correct most: where the rules of the platform&apos;s own reader get better.</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Proposals ({runs.total})</p>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-700" data-testid="import-modes">
            <li>Read by the platform alone: <b>{runs.byMode.internal}</b></li>
            <li>Platform + AI for the parts that failed: <b>{runs.byMode['internal+ai']}</b></li>
            <li>AI for everything: <b>{runs.byMode.ai}</b></li>
            {runs.byMode.unknown > 0 && <li>Before the platform reader existed: <b>{runs.byMode.unknown}</b></li>}
            <li className="pt-1 text-gray-500">Average coverage {pct(runs.avgCoverage)} · clear types {pct(runs.avgTypeConfidence)}{runs.avgDurationMs != null ? ` · ${Math.round(runs.avgDurationMs / 1000)} s` : ''}</li>
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Corrections ({c.total})</p>
          {c.total === 0 ? <p className="mt-1 text-xs text-gray-500">None yet.</p> : (
            <ul className="mt-1 space-y-0.5 text-xs text-gray-700" data-testid="import-correction-list">
              {c.byKind.map((k) => <li key={k.kind}>{LABEL[k.kind] ?? k.kind}: <b>{k.count}</b></li>)}
              {c.kindChanges.length > 0 && <li className="pt-1 text-gray-500">Most common kind changes:</li>}
              {c.kindChanges.slice(0, 6).map((k) => <li key={`${k.from}>${k.to}`} className="pl-3">{k.from} → {k.to}: <b>{k.count}</b> <span className="text-gray-400">(platform {k.internal}, AI {k.ai})</span></li>)}
              {c.deleted.length > 0 && <li className="pt-1 text-gray-500">Most deleted kinds: {c.deleted.slice(0, 4).map((x) => `${x.kind} (${x.count})`).join(', ')}</li>}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
