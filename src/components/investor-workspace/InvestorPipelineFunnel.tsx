'use client';
// Prompt 681 §1.2 — "Mesmo componente dos cartões do founder... mesmas
// dimensões". PipelineFunnel.tsx (founder side) hard-imports its own
// taxonomy rather than taking cards as a prop, so importing it directly
// would mean forking its behaviour to fit six different keys and no
// roll-up variant — reworking that shared, heavily-used founder component
// for one caller was judged riskier than this: the exact same JSX shape,
// spacing, and TONE palette (imported, not copied, so a future palette
// change stays in one place), parameterized for the investor's own
// taxonomy. No drag-drop here — §4 attaches drop handling to these same
// card buttons directly (unlike the founder side's separate drop-target
// buttons, since Prompt 681 explicitly asks for the cards themselves to be
// the targets).
import { TONE } from '@/components/pipeline/PipelineFunnel';
import { INVESTOR_PIPELINE_CARDS, type InvestorPipelineCardKey, type InvestorPipelineCounts } from '@/lib/investor-pipeline-taxonomy';
import { investorDropTargetAccepts, NON_DROP_TARGET_MESSAGE, type InvestorDropTarget } from '@/lib/investor-pipeline-drop';

const ICON: Record<InvestorPipelineCardKey, string> = {
  new: '👋', evaluating: '🔍', interested: '🖐', due_diligence: '📄', passed: '✕', archived: '📦',
};

export function InvestorPipelineFunnel({ counts, activeFilter, onFilter, dragActive, dragOver }: {
  counts: InvestorPipelineCounts;
  activeFilter: InvestorPipelineCardKey | null;
  onFilter: (key: InvestorPipelineCardKey | null) => void;
  /** Prompt 681 §4 — a drag is in progress somewhere; every card gets a hint ring. */
  dragActive?: boolean;
  /** The dragged row is currently over this card. */
  dragOver?: InvestorDropTarget | null;
}) {
  const total = INVESTOR_PIPELINE_CARDS.reduce((sum, c) => sum + counts[c.key], 0);

  return (
    <div className="md:shrink-0">
      <div className="flex flex-wrap items-stretch gap-1.5">
        {INVESTOR_PIPELINE_CARDS.map((card) => {
          const t = TONE[card.tone];
          const n = counts[card.key];
          const on = activeFilter === card.key;
          const pct = Math.max(3, total ? (n / total) * 100 : 0);
          const accepts = investorDropTargetAccepts(card.key);
          const isOver = dragOver === card.key;
          const dropRing = !dragActive ? '' : isOver
            ? (accepts ? 'ring-2 ring-[#0E7490] investor-pipeline-drop-armed' : 'ring-2 ring-gray-300')
            : (accepts ? 'ring-1 ring-[#0E7490]/30' : '');
          const dropTitle = dragActive && !accepts
            ? NON_DROP_TARGET_MESSAGE[card.key]
            : `${card.label} — ${card.context}. Click to filter the list.`;
          return (
            <div key={card.key} className="flex flex-1 items-stretch">
              <button
                type="button"
                data-investor-drop-target={card.key}
                onClick={() => onFilter(on ? null : card.key)}
                aria-pressed={on}
                title={dropTitle}
                style={{ color: t.fg, boxShadow: on ? `inset 0 0 0 2px ${t.fg}` : undefined }}
                className={`relative min-w-[142px] flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-gray-300 ${dropRing}`}
              >
                <span className="mb-2 grid h-[30px] w-[30px] place-items-center rounded-[9px] text-[13px]"
                  style={{ background: t.wash, color: t.fg }}>{ICON[card.key]}</span>
                <span className="block text-[12px] font-semibold text-gray-500">{card.label}</span>
                <span className="mt-0.5 flex items-baseline gap-1.5">
                  <b className="text-[25px] font-extrabold tabular-nums tracking-tight text-gray-900">{n}</b>
                  <span className="text-[11.5px] text-gray-400">startups</span>
                </span>
                <span className="mt-2.5 block h-1 overflow-hidden rounded-[3px] bg-gray-100">
                  <i className="block h-full rounded-[3px]" style={{ width: `${pct.toFixed(1)}%`, background: t.fg }} />
                </span>
              </button>
              {card.arrowAfter && <span aria-hidden className="grid w-2.5 shrink-0 place-items-center text-gray-300">›</span>}
              {card.sepAfter && <span aria-hidden className="mx-1.5 my-2.5 w-px shrink-0 self-stretch bg-gray-200" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
