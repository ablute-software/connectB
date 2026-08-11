'use client';
// Prompt 166 §C — SWOT quadrant, the first element of the Review sub-tab.
// Reads the 4 bullet arrays off the latest already-stored review_runs
// report (via the `data` prop, passed down from ReviewPanel's own
// already-fetched `runs`) — makes NO AI call of its own, zero extra token
// cost per Nuno's own instruction.
//
// SwotQuadrant is the bare header + 2x2 grid, exported separately so the
// investor-facing dossier page (Prompt 166 §D) can reuse the exact same
// layout read-only, without pulling in the founder-only run/lock/CTA
// wrapper below it.
import { Card } from '@/components/ui';
import type { SwotData } from '@/lib/types';
import { ClarificationBullet } from './ClarificationBullet';
import { clarificationKey, type ReviewClarification } from '@/lib/review-clarifications';

// Prompt 172 §B — v2 redesign: Prompt 170's tinted-container + filled-item
// treatment still read as chat bubbles, not a product card. This drops the
// quadrant's own colored background (now plain white, only a thin colored
// border carries the category color) and replaces each item's filled
// mini-card with a plain outlined row + a small color dot (no icon) — the
// "chat" read came from white bubbles floating on a tinted wash, not from
// any one piece in isolation. Weaknesses moves orange -> amber/gold and
// Threats moves the dark #B00000 -> a brighter red/coral, both to match the
// reference; Strengths/Opportunities keep their existing hues.
const QUADRANTS: {
  key: keyof SwotData; label: string; caption: string; icon: string;
  border: string; iconBadge: string; countPill: string; dot: string;
}[] = [
  {
    key: 'strengths', label: 'Strengths', caption: 'What gives you a competitive advantage?', icon: '💪',
    border: 'border-emerald-200', iconBadge: 'bg-emerald-600',
    countPill: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500',
  },
  {
    key: 'weaknesses', label: 'Weaknesses', caption: 'What are your main limitations?', icon: '⚠️',
    border: 'border-amber-200', iconBadge: 'bg-amber-500',
    countPill: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500',
  },
  {
    key: 'opportunities', label: 'Opportunities', caption: 'What external factors could help you?', icon: '🚀',
    border: 'border-blue-200', iconBadge: 'bg-blue-600',
    countPill: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500',
  },
  {
    key: 'threats', label: 'Threats', caption: 'What external risks could impact you?', icon: '⚡',
    border: 'border-red-200', iconBadge: 'bg-red-500',
    countPill: 'border-red-200 bg-red-50 text-red-600', dot: 'bg-red-500',
  },
];

// Prompt 172 §A — full-width header card above the 4 quadrants: brand
// gradient (#0E7490 -> #22D3EE, the exact two-tone pair brand.ts itself
// names as the product's colours — not a new/invented gradient), a bigger
// icon badge than the quadrants use, title + purpose subtitle, and a
// translucent "Tip" callout on the right. No dedicated reusable "Tip"
// component exists elsewhere in the app (checked — PipelinePanel.tsx's own
// 💡 hint is just an ad hoc styled box, not a shared component), so this
// reuses that same spirit — icon + short line in a light box — rather than
// inventing an unrelated visual language.
function SwotHeader() {
  return (
    <div className="relative overflow-hidden rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #0E7490 0%, #22D3EE 100%)' }}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-2xl">
            📊
          </span>
          <div>
            <div className="text-xl font-bold text-white">SWOT Analysis</div>
            <p className="mt-0.5 max-w-md text-sm text-cyan-50/90">
              Evaluate internal strengths and weaknesses, and external opportunities and threats to guide your fundraising strategy.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-2 rounded-xl bg-white/95 px-3.5 py-2.5 shadow-sm">
          <span aria-hidden="true" className="text-base">💡</span>
          <div>
            <div className="text-xs font-semibold text-gray-800">Tip</div>
            <p className="max-w-[220px] text-[11px] leading-snug text-gray-600">
              Focus on what&apos;s material for investors and your next funding round.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Prompt 168 §B — `clarify` is only ever passed by SwotVisualCard's own
// founder-facing wrapper below (the latest run, editable). The
// investor-facing dossier page (Prompt 166 §D) renders SwotQuadrant
// directly with no `clarify` prop, so it stays exactly the plain read-only
// grid it's always been — the bubble/editor UI never reaches that surface.
// Prompt 170/172 — the redesign below applies to BOTH surfaces automatically
// (same shared component), no extra work needed for the investor side.
export function SwotQuadrant({ data, clarify }: {
  data: SwotData;
  clarify?: { orgId: string; reviewRunId: string; clarifications: Map<string, ReviewClarification>; onSaved: (c: ReviewClarification) => void };
}) {
  return (
    <div className="space-y-4">
      <SwotHeader />
      <div className="grid gap-4 sm:grid-cols-2">
        {QUADRANTS.map((q) => {
          const items = data[q.key] ?? [];
          return (
            <div key={q.key} className={`rounded-2xl border bg-white p-4 shadow-sm ${q.border}`}>
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
                <div className="mt-3 space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800">
                      <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${q.dot}`} />
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
                <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-2.5 text-sm text-gray-400">Nothing flagged.</p>
              )}
            </div>
          );
        })}
      </div>
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
    <Card title={data ? undefined : <span className="text-[#0E7490]">SWOT snapshot</span>}>
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
