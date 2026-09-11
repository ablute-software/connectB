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
// The drag-to-card gesture (the "door" flip, Active refusing drops) is Phase 4;
// this phase is the static, filtering header.
import { PIPELINE_CARDS, type PipelineCardKey, type PipelineCounts } from '@/lib/pipeline-taxonomy';

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

export function PipelineFunnel({ counts, activeFilter, onFilter }: {
  counts: PipelineCounts;
  activeFilter: PipelineCardKey | null;
  onFilter: (key: PipelineCardKey | null) => void;
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
          return (
            <div key={card.key} className="flex items-stretch">
              <button
                type="button"
                onClick={() => onFilter(on ? null : card.key)}
                aria-pressed={on}
                title={card.rollup
                  ? 'Everyone except Passed — a running total, not a stage. Click to see them all.'
                  : `${card.label}${card.context ? ` — ${card.context}` : ''}. Click to filter the list.`}
                style={{ color: t.fg, boxShadow: on ? `inset 0 0 0 2px ${t.fg}` : undefined }}
                className={`relative min-w-[142px] flex-1 overflow-hidden rounded-2xl border p-3 text-left shadow-sm transition
                  ${card.rollup ? 'border-dashed border-gray-300 bg-[#fafcfd]' : 'border-gray-200 bg-white hover:border-gray-300'}`}
              >
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
