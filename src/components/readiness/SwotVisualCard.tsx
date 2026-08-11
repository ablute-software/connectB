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
import { ClarificationBullet } from './ClarificationBullet';
import { clarificationKey, type ReviewClarification } from '@/lib/review-clarifications';

// Prompt 170 §B — redesign: a square icon badge (solid category color) +
// title + descriptive caption in the header, a count pill top-right, and
// every bullet as its own mini-card (lighter tint than the quadrant's own
// background) instead of a loose `<li>` bullet. Palette unchanged (green/
// orange/blue/red-terracotta) — only the treatment (solid badges/pills/
// mini-cards vs. flat tinted boxes) is new, per the reference design; #0E7490
// stays the app's own contrast/accent reference, used on SwotVisualCard's
// own title below, not inside the quadrant colors themselves.
const QUADRANTS: {
  key: keyof SwotData; label: string; caption: string; icon: string;
  container: string; iconBadge: string; countPill: string; itemCard: string;
}[] = [
  {
    key: 'strengths', label: 'Strengths', caption: 'What gives you a competitive advantage?', icon: '💪',
    container: 'border-emerald-200 bg-emerald-50/60',
    iconBadge: 'bg-emerald-600',
    countPill: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    itemCard: 'border-emerald-100 bg-white',
  },
  {
    key: 'weaknesses', label: 'Weaknesses', caption: 'What are your main limitations?', icon: '⚠️',
    container: 'border-orange-200 bg-orange-50/60',
    iconBadge: 'bg-orange-500',
    countPill: 'border-orange-200 bg-orange-100 text-orange-700',
    itemCard: 'border-orange-100 bg-white',
  },
  {
    key: 'opportunities', label: 'Opportunities', caption: 'What external factors could help you?', icon: '🚀',
    container: 'border-blue-200 bg-blue-50/60',
    iconBadge: 'bg-blue-600',
    countPill: 'border-blue-200 bg-blue-100 text-blue-700',
    itemCard: 'border-blue-100 bg-white',
  },
  {
    key: 'threats', label: 'Threats', caption: 'What external risks could impact you?', icon: '⚡',
    container: 'border-red-200 bg-red-50/60',
    iconBadge: 'bg-[#B00000]',
    countPill: 'border-red-200 bg-red-100 text-[#B00000]',
    itemCard: 'border-red-100 bg-white',
  },
];

// Prompt 168 §B — `clarify` is only ever passed by SwotVisualCard's own
// founder-facing wrapper below (the latest run, editable). The
// investor-facing dossier page (Prompt 166 §D) renders SwotQuadrant
// directly with no `clarify` prop, so it stays exactly the plain read-only
// grid it's always been — the bubble/editor UI never reaches that surface.
// Prompt 170 §B — the redesign below applies to BOTH surfaces automatically
// (same shared component), no extra work needed for the investor side.
export function SwotQuadrant({ data, clarify }: {
  data: SwotData;
  clarify?: { orgId: string; reviewRunId: string; clarifications: Map<string, ReviewClarification>; onSaved: (c: ReviewClarification) => void };
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {QUADRANTS.map((q) => {
        const items = data[q.key] ?? [];
        return (
          <div key={q.key} className={`rounded-2xl border p-4 ${q.container}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${q.iconBadge}`}>
                  {q.icon}
                </span>
                <div>
                  <div className="text-sm font-bold text-gray-900">{q.label}</div>
                  <div className="text-[11px] text-gray-500">{q.caption}</div>
                </div>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${q.countPill}`}>
                {items.length} item{items.length === 1 ? '' : 's'}
              </span>
            </div>
            {items.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                {items.map((item, i) => (
                  <div key={i} className={`flex items-start justify-between gap-1.5 rounded-lg border px-3 py-2 text-xs text-gray-700 ${q.itemCard}`}>
                    <span className="flex-1">{item}</span>
                    {clarify && (
                      <ClarificationBullet
                        orgId={clarify.orgId} reviewRunId={clarify.reviewRunId} category={q.key} itemIndex={i} itemText={item}
                        existing={clarify.clarifications.get(clarificationKey(clarify.reviewRunId, q.key, i)) ?? null}
                        onSaved={clarify.onSaved}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-gray-200 bg-white/60 px-3 py-2 text-xs text-gray-400">Nothing flagged.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SwotVisualCard({ data, canRun, lockedReason, running, onRun, clarify }: {
  data: SwotData | null;
  /** Whether a NEW review can be started right now (feature on + quota left). */
  canRun: boolean;
  /** Set (non-empty) when there's no `data` yet AND a new review can't be started either
   *  — quota exhausted or the feature isn't on for this plan. Renders the frost/lock
   *  treatment instead of the plain "run a review" empty state (§C.4). */
  lockedReason: string | null;
  running: boolean;
  onRun: () => void;
  /** Prompt 168 §B — omit to render the quadrant read-only (no `data` means
   *  there's nothing to clarify yet anyway). */
  clarify?: { orgId: string; reviewRunId: string; clarifications: Map<string, ReviewClarification>; onSaved: (c: ReviewClarification) => void };
}) {
  return (
    <Card title={<span className="text-[#0E7490]">SWOT snapshot</span>}>
      {data ? (
        <SwotQuadrant data={data} clarify={clarify} />
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
