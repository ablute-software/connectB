'use client';
// Prompt 166 §C — SWOT quadrant, the first element of the Review sub-tab.
// Reads the 4 bullet arrays off the latest already-stored review_runs
// report (via the `data` prop, passed down from ReviewPanel's own
// already-fetched `runs`) — makes NO AI call of its own, zero extra token
// cost per Nuno's own instruction.
//
// SwotQuadrant is the bare 2x2 grid, exported separately so the
// investor-facing dossier page (Prompt 166 §D) can reuse the exact same
// layout read-only, without pulling in the founder-only run/lock/CTA
// wrapper below it.
import { Card } from '@/components/ui';
import type { SwotData } from '@/lib/types';

const QUADRANTS: { key: keyof SwotData; label: string; icon: string; classes: string }[] = [
  { key: 'strengths', label: 'Strengths', icon: '💪', classes: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  { key: 'weaknesses', label: 'Weaknesses', icon: '⚠️', classes: 'border-orange-200 bg-orange-50 text-orange-800' },
  { key: 'opportunities', label: 'Opportunities', icon: '🚀', classes: 'border-blue-200 bg-blue-50 text-blue-800' },
  { key: 'threats', label: 'Threats', icon: '⚡', classes: 'border-red-200 bg-red-50 text-[#B00000]' },
];

export function SwotQuadrant({ data }: { data: SwotData }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {QUADRANTS.map((q) => (
        <div key={q.key} className={`rounded-lg border p-3 ${q.classes}`}>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
            <span aria-hidden="true">{q.icon}</span><span>{q.label}</span>
          </div>
          {data[q.key]?.length ? (
            <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-xs">
              {data[q.key].map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          ) : (
            <p className="mt-1.5 text-xs opacity-60">Nothing flagged.</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function SwotVisualCard({ data, canRun, lockedReason, running, onRun }: {
  data: SwotData | null;
  /** Whether a NEW review can be started right now (feature on + quota left). */
  canRun: boolean;
  /** Set (non-empty) when there's no `data` yet AND a new review can't be started either
   *  — quota exhausted or the feature isn't on for this plan. Renders the frost/lock
   *  treatment instead of the plain "run a review" empty state (§C.4). */
  lockedReason: string | null;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <Card title={<span className="text-[#0E7490]">SWOT snapshot</span>}>
      {data ? (
        <SwotQuadrant data={data} />
      ) : lockedReason ? (
        <div className="relative overflow-hidden rounded-lg border border-dashed border-gray-200 bg-white/60 px-4 py-6 text-center backdrop-blur-[2px]">
          <span className="rounded-full border border-cyan-200 bg-white/90 px-3 py-1 text-xs font-semibold text-[#0E7490] shadow-sm">
            {lockedReason}
          </span>
          <p className="mt-2 text-[11px] text-gray-400">Your SWOT will appear here once a review can run again.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center">
          <p className="text-sm text-gray-500">Run a review to see your SWOT here.</p>
          <button disabled={!canRun || running} onClick={onRun}
            className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {running ? 'Running…' : 'Run review'}
          </button>
        </div>
      )}
    </Card>
  );
}
