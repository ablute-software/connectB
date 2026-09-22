'use client';
// Prompt 650 Phase 1 — the six-card funnel at the top of the Pipeline. One
// vocabulary, drawn from pipeline-taxonomy.ts, with the counts that finally add
// up: Not contacted › Contacted › Due diligence ‖ Active · Passed · Frozen. The
// three funnel stages carry `›` arrows, a divider separates them from the
// roll-up and the two shelves, and Active is styled as a roll-up (dashed, muted,
// a "roll-up" tag) because it is total − passed and overlaps the others — never
// a stage of its own. Clicking a card filters the list to that bucket (Active
// filters to everything except Passed); clicking the active card clears it.
//
// Prompt 704 (18/09/2026) — Phase 4, finally built: every non-roll-up card is
// now also a drop target (data-drop-target, the same attribute
// usePipelineRowDrag's hitTest already scans for). Active gets none: it "is
// total − passed, overlaps the buckets, is not a drop target, has no group"
// (pipeline-taxonomy.ts's own words) — there's no single status a drop on a
// roll-up could mean, so it keeps refusing drops exactly as this file's own
// header always said it would. dragActive/dragOver/dragPulse are optional so
// a caller that never drags (there is none today, but the type shouldn't
// assume it) gets the exact old static header.
import { PIPELINE_CARDS, type PipelineCardKey, type PipelineCounts } from '@/lib/pipeline-taxonomy';
import { DROP_TARGET_INTERIOR, dropTargetAccepts } from '@/lib/pipeline-drop';

// The prototype's stage palette (foreground + wash), kept here so the funnel
// reads as its own system without pulling a whole design-token layer into the
// app. Active's chip is green; its card is the muted roll-up treatment.
export const TONE: Record<string, { fg: string; wash: string }> = {
  slate: { fg: '#5d7280', wash: '#eef3f6' },
  blue: { fg: '#1d6fd4', wash: '#e9f2fd' },
  amber: { fg: '#b4670c', wash: '#fdf3e6' },
  green: { fg: '#158049', wash: '#e6f6ed' },
  rose: { fg: '#b81a49', wash: '#fdecf1' },
  cyan: { fg: '#0e7490', wash: '#e6f5fa' },
};

export const ICON: Record<PipelineCardKey, string> = {
  not_contacted: '👥', contacted: '💬', diligence: '📄', active: '✈', passed: '✕', frozen: '❄',
};

export function PipelineFunnel({ counts, activeFilter, onFilter, dragActive, dragOver, dragPulse }: {
  counts: PipelineCounts;
  activeFilter: PipelineCardKey | null;
  onFilter: (key: PipelineCardKey | null) => void;
  /** Prompt 704 — a row is being dragged; every non-roll-up card becomes a
      drop target (armed) and the one under the pointer opens (open). No
      reduced-motion prop: unlike the door-flip toolbar buttons this
      replaces, the highlight here is a plain ring/border swap, already
      motion-free, so there's nothing to turn off. */
  dragActive?: boolean;
  dragOver?: PipelineCardKey | null;
  dragPulse?: PipelineCardKey | null;
}) {
  // The bar's scale is the real total (the five buckets), so a bar's length
  // reads as a share of the whole pipeline; Active's own bar can reach full.
  const realTotal = counts.not_contacted + counts.contacted + counts.diligence + counts.passed + counts.frozen;

  return (
    <div className="md:shrink-0">
      <div className="flex flex-wrap items-stretch gap-1.5">
        {PIPELINE_CARDS.map((card) => {
          const t = TONE[card.tone];
          const n = counts[card.key];
          const on = activeFilter === card.key;
          const pct = Math.max(3, realTotal ? (n / realTotal) * 100 : 0);
          // Prompt 704 — a drop target iff dropTargetAccepts says so, which
          // is exactly "one of the five real buckets" today; reusing that
          // function here (rather than `!card.rollup`) means the two can
          // never quietly drift apart.
          const isDropTarget = dropTargetAccepts(card.key);
          const open = isDropTarget && dragOver === card.key;
          const armed = isDropTarget && !!dragActive && !open;
          const pulse = isDropTarget && dragPulse === card.key;
          return (
            /* Prompt 676 §1 — flex-1 on the button only fills ITS OWN parent
               (this wrapper), which is a single-child flex container of
               intrinsic size; nothing was telling the wrapper itself to
               grow into the OUTER row's leftover space, so the row's total
               width stopped at min-content and left a gap before the
               right edge the list/panel below always reaches (a bare
               block div, full width by default). flex-1 here is what
               actually closes that gap — the arrows/divider stay
               shrink-to-fit, unaffected. */
            <div key={card.key} className="flex flex-1 items-stretch">
              <button
                type="button"
                data-drop-target={isDropTarget ? card.key : undefined}
                onClick={() => onFilter(on ? null : card.key)}
                aria-pressed={on}
                title={card.rollup
                  ? 'Everyone except Passed — a running total, not a stage. Click to see them all — never a drop target, it has no single status of its own.'
                  : `${card.label}${card.context ? ` — ${card.context}` : ''}. Click to filter the list, or drag a row here to move it.`}
                style={{ color: t.fg, boxShadow: (on || open) ? `inset 0 0 0 2px ${t.fg}` : undefined }}
                className={`relative min-w-[142px] flex-1 overflow-hidden rounded-2xl border p-3 text-left shadow-sm transition
                  ${card.rollup ? 'border-dashed border-gray-300 bg-[#fafcfd]' : 'border-gray-200 bg-white hover:border-gray-300'}
                  ${armed ? 'pipeline-drop-armed' : ''} ${pulse ? 'pipeline-count-pulse' : ''}
                  ${open ? 'ring-2 ring-offset-1' : ''}`}
              >
                {open ? (
                  <div className="flex h-full min-h-[74px] flex-col items-start justify-center gap-1" style={{ color: t.fg }}>
                    <span className="text-[13px]">{ICON[card.key]}</span>
                    <span className="text-[12px] font-semibold">{DROP_TARGET_INTERIOR[card.key as Exclude<PipelineCardKey, 'active'>]}</span>
                  </div>
                ) : (
                  <>
                    <span className="mb-2 grid h-[30px] w-[30px] place-items-center rounded-[9px] text-[13px]"
                      style={{ background: t.wash, color: t.fg }}>{ICON[card.key]}</span>
                    {card.rollup && (
                      <span className="absolute right-3 top-3 font-mono text-[9.5px] tracking-wide text-gray-400">roll-up</span>
                    )}
                    <span className="block text-[12px] font-semibold text-gray-500">{card.label}</span>
                    <span className="mt-0.5 flex items-baseline gap-1.5">
                      <b className="text-[25px] font-extrabold tabular-nums tracking-tight text-gray-900">{n}</b>
                      <span className="text-[11.5px] text-gray-400">investors</span>
                    </span>
                    <span className="mt-2.5 block h-1 overflow-hidden rounded-[3px] bg-gray-100">
                      <i className="block h-full rounded-[3px]" style={{ width: `${pct.toFixed(1)}%`, background: t.fg }} />
                    </span>
                  </>
                )}
                {pulse && (
                  <span aria-hidden className="pipeline-plus-one pointer-events-none absolute right-2 top-2 text-[11px] font-bold" style={{ color: t.fg }}>+1</span>
                )}
              </button>
              {/* Funnel arrow after the first two stages; a divider before the shelves. */}
              {card.arrowAfter && <span aria-hidden className="grid w-2.5 shrink-0 place-items-center text-gray-300">›</span>}
              {card.sepAfter && <span aria-hidden className="mx-1.5 my-2.5 w-px shrink-0 self-stretch bg-gray-200" />}
            </div>
          );
        })}
      </div>
      <p className="mt-2 font-mono text-[11px] text-gray-400">
        Not contacted + Contacted + Due diligence + Passed + Frozen = {realTotal}
        {' · '}Active ({counts.active}) is a roll-up: everyone except passed.
      </p>
    </div>
  );
}
