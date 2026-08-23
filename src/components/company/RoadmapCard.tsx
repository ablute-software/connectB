'use client';
// Prompt 167 — Company tab roadmap: a horizontal timeline of hand-written
// milestones (never AI-generated — see the prompt's own "Não incluído
// aqui"). RoadmapTimeline is the shared, purely presentational piece:
// founder-editable here (RoadmapCard, mounted above IdentityCard in
// CompanyPanel.tsx) and reused read-only on the investor-facing dossier
// (portal/startup/[orgId]/page.tsx, Prompt 167 §C) — same component, just
// `editable={false}` and no callbacks, so the redesign/behavior of one
// never has to be kept in sync with a second copy of the other.
//
// Prompt 175/177 — earlier visual passes; see git history for their own
// header notes. Prompt 185 (this one) supersedes both in two ways:
//
// §A — a real structural bug, confirmed in code, independent of any image:
// the scroll container set `overflow-x-auto` with `overflow-y` left
// implicit. Per the CSS Overflow spec, a `visible`/`auto` MISMATCH between
// the two axes is not a legal computed state — the browser silently
// promotes the implicit axis (overflow-y here) to `auto` too. That turns
// the container into a clipping box on BOTH axes, and the "cards grow
// upward out of a fixed h-28 box via items-end" trick (used so a shorter
// card still sits flush against the axis) was relying on overflow-y
// staying `visible` — it never actually was, so any card taller than 112px
// got its top sliced off.
//
// First fix attempt (flex-1 on each per-node column's card slots, relying
// on the row's items-stretch) removed the clipping but broke something
// else, caught live before shipping: the axis line stopped being level.
// Reason, confirmed by measuring real node centers in a running browser —
// 426px to 604px across one row, should all match: each per-node column
// has TWO flex-1 slots (top card, bottom card), and only one of them ever
// holds a card. Flexbox distributes a stretched column's surplus height
// 50/50 across BOTH flex-1 siblings regardless of which one actually has
// content, so a column's own empty slot silently ate half of any extra
// height meant for its occupied slot — pushing that column's axis row up
// or down relative to its neighbors, independently, column by column.
// Flexbox has no way to say "this row's height must match the tallest
// SAME-ROW cell across every column" — only CSS Grid does. Rebuilt as one
// grid per timeline (not one flex-col per node): 4 shared rows (top-card,
// axis, label, bottom-card) spanning every column, each column supplying
// only the rows it actually uses via explicit grid-row/grid-column
// placement. A grid row's height is the max of whatever's actually placed
// in it, shared identically across all columns — verified live afterward:
// every node's vertical center landed on the exact same pixel.
//
// Also added real mouse-wheel-to-horizontal and drag-the-thumb scrolling
// (ScrollBar) — the click-320px-at-a-time chevrons alone made the trailing
// "Add milestone" button unreachable in some browsers with more than a
// couple of milestones.
//
// §B — pixel-match pass against an attached reference image (not text):
// Founded's axis node is a solid amber "target" (inset white ring, no
// flag — the flag lives on the CARD only, unchanged), the axis line is
// solid-then-dashed in ONE color family (teal) rather than two colors,
// each card has a small triangle pointing at its own node, year-kind nodes
// (2022/2024/2026/2027) are visibly larger than quarter-kind nodes (Q4
// 2023/Q2 2025/etc — TWO node sizes, not one shared NODE_SIZE), future
// (hollow) nodes get a thicker border than past (filled) ones, and
// Founded's own "2022" label — which drifted after Prompt 177 removed the
// leading line segment before the very first node — is now aligned to the
// node's actual (flush-left) position instead of the column's center.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { detectPastRound, type PastRoundHint } from '@/lib/round-propagation';
import { readItems, itemCategoryLabel, CATEGORY_COLORS, CATEGORY_SHAPES, COLOR_STYLES, SHAPE_STYLES, GENERAL_LABEL, type CategoryColor, type CategoryShape } from '@/lib/roadmap-categories';
import type { RoadmapItemV2, RoadmapCategory } from '@/lib/types';
import { Card, TermHint, Toggle } from '@/components/ui';
import { AiSupportButton } from './AiSupportButton';
import type { RoadmapMilestone, RoadmapPeriodKind } from '@/lib/types';
import { periodHasPassed, periodLabel, sortRoadmapPeriods, type RoadmapPeriod } from '@/lib/roadmap';

const QUARTERS = [1, 2, 3, 4] as const;
// Prompt 185 §B.5 — year-kind nodes (Founded included — it's inherently a
// year) are visibly bigger than quarter-kind nodes; no longer one shared size.
const NODE_SIZE_YEAR = 'h-8 w-8';
const NODE_SIZE_QUARTER = 'h-5 w-5';
const CARD_WIDTH = 'w-56';
const CONTAINER_WIDTH = 'w-60';

// Prompt 185 §A — the 4 shared grid rows every column places into (1-based,
// CSS grid convention). Only ROW_AXIS and ROW_LABEL are used by every
// column; ROW_TOP_CARD/ROW_BOTTOM_CARD are used by whichever half of the
// milestones sits on that side, and left untouched (not zero-height, just
// unoccupied — a grid row's size never depends on absent cells) otherwise.
const ROW_TOP_CARD = 1;
const ROW_AXIS = 2;
const ROW_LABEL = 3;
const ROW_BOTTOM_CARD = 4;

// Prompt 175 §B.1 — "rodar por uma pequena paleta... não necessariamente
// ligado ao passado/futuro" (Nuno's own words): a milestone's card color
// is purely its position in the rotation, never its past/future status —
// that signal lives in the status badge (§B.2) and the axis node instead.
// Prompt 185 §B.4 — triangleDown/triangleUp added: literal, full Tailwind
// class strings (not built from a variable color name) so the JIT scanner
// can actually find them — the same reason every other color in this
// object was already spelled out per-theme instead of interpolated.
// Prompt 194 — nodeColor is new: a real hex (not a Tailwind class) for the
// axis node's own fill/border AND as a gradient stop for its adjacent line
// segments (AxisLine, below) — a CSS gradient needs an actual color value,
// not a class name, so this can't reuse bg/dot/etc the way everything else
// here does. One color per theme, used for BOTH the filled (past) and
// hollow (future) states of a node — §194's own correction to 185's
// reading was that the axis follows each card's rotation color, not a
// separate fixed past/future palette; fill-vs-hollow stays a state (solid
// bg vs white+border), never a second color. Values are Tailwind's own
// emerald-500/blue-500/purple-500 hex, so a themed node matches its card's
// -500 tones exactly.
const CARD_THEMES = [
  {
    bg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500',
    statusOn: 'border-emerald-500 bg-emerald-500', statusOff: 'border-emerald-300 bg-white text-emerald-300',
    triangleDown: 'border-t-8 border-t-emerald-50', triangleUp: 'border-b-8 border-b-emerald-50',
    nodeColor: '#10b981',
  },
  {
    bg: 'bg-blue-50', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500',
    statusOn: 'border-blue-500 bg-blue-500', statusOff: 'border-blue-300 bg-white text-blue-300',
    triangleDown: 'border-t-8 border-t-blue-50', triangleUp: 'border-b-8 border-b-blue-50',
    nodeColor: '#3b82f6',
  },
  {
    bg: 'bg-purple-50', badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500',
    statusOn: 'border-purple-500 bg-purple-500', statusOff: 'border-purple-300 bg-white text-purple-300',
    triangleDown: 'border-t-8 border-t-purple-50', triangleUp: 'border-b-8 border-b-purple-50',
    nodeColor: '#a855f7',
  },
];
const FOUNDED_TRIANGLE_DOWN = 'border-t-8 border-t-amber-50';
// Tailwind's amber-500 — Founded's own node is already amber (§194 point
// 1, "já está certo, não mexer"); this is only the hex twin of that same
// color, needed as a gradient stop for the line leaving Founded.
const FOUNDED_NODE_COLOR = '#f59e0b';

// Prompt 185 §B.4 — a small CSS-border triangle (zero-size box, two
// transparent side-borders + one colored border) pointing at the node it
// belongs to: `border-t-*` for a card sitting ABOVE the axis (colored top
// edge, point hangs down toward the line), `border-b-*` for a card BELOW
// it (colored bottom edge, point rises up toward the line).
function CardTriangle({ colorClass }: { colorClass: string }) {
  return <div aria-hidden="true" className={`mx-auto mb-1 h-0 w-0 border-x-8 border-x-transparent ${colorClass}`} />;
}

// Prompt 177 §1 / Prompt 185 §B.3 — one shared line-segment renderer.
// Prompt 194 rewrites the "one fixed color" reading: the reference image's
// axis is a genuine, continuous color gradient that follows each node's own
// theme (green -> teal/blue -> purple), not two flat tones. A CSS border
// can't carry a gradient AND a dash pattern at once, so both `solid` and
// dashed segments render as the SAME `background: linear-gradient(...)` bar
// (a real 2-stop interpolation between this segment's two node colors);
// `solid=false` (the "still ahead" half) additionally applies a repeating
// mask over that bar to punch it into dashes — the gradient underneath is
// untouched, so the dashes themselves carry the same color transition
// instead of falling back to a flat tint. This is the "mask over a
// gradient bar" option named in the prompt itself, chosen over an SVG
// <line>/<linearGradient> because the rest of this component is plain
// JSX/Tailwind, not SVG.
const DASH_MASK = 'repeating-linear-gradient(to right, #000 0, #000 4px, transparent 4px, transparent 8px)';
function AxisLine({ fromColor, toColor, solid }: { fromColor: string; toColor: string; solid: boolean }) {
  const background = `linear-gradient(to right, ${fromColor}, ${toColor})`;
  return (
    <div className="h-0.5 flex-1"
      style={solid ? { background } : { background, WebkitMaskImage: DASH_MASK, maskImage: DASH_MASK }} />
  );
}

// Prompt 185 §A — each node contributes explicitly grid-positioned cells
// (grid-column pins it to its own slot in the timeline; grid-row picks
// which of the 4 shared rows) instead of a single self-contained flex
// column — see the file header for why that's what actually keeps every
// column's axis row level with its neighbors regardless of card height.
function FoundedNode({ foundedYear, col, nextColor }: { foundedYear: number | null; col: number; nextColor: string }) {
  const colStyle = { gridColumn: col };
  return (
    <>
      <div style={{ ...colStyle, gridRow: ROW_TOP_CARD }} className={`flex ${CONTAINER_WIDTH} flex-col items-center justify-end`}>
        {foundedYear == null ? (
          <div className={`${CARD_WIDTH} rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3 text-center text-xs text-amber-800`}>
            Set your founding year in <a href="#settings-identity" className="font-semibold underline">Identity</a> to start your roadmap.
          </div>
        ) : (
          <>
            <div className={`${CARD_WIDTH} rounded-xl bg-amber-50 p-3.5 shadow-sm`}>
              <div className="flex items-center justify-between gap-1.5">
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Founded</span>
                {/* §B.2 — the flag lives on the card, never the axis node —
                    already correct pre-185, unchanged. */}
                <span aria-hidden="true" className="text-base">🚩</span>
              </div>
              <div className="mt-1.5 text-2xl font-bold text-amber-900">{foundedYear}</div>
              <div className="text-xs text-amber-700/80">Company founded</div>
            </div>
            <CardTriangle colorClass={FOUNDED_TRIANGLE_DOWN} />
          </>
        )}
      </div>
      <div style={{ ...colStyle, gridRow: ROW_AXIS }} className={`flex ${CONTAINER_WIDTH} items-center`}>
        {/* Nothing precedes the very first node — no line drawn (not even
            invisible-width flex-1, which would push the dot off-center). */}
        {/* §B.1 — a solid amber "target": filled circle with a thin white
            ring INSET (drawn inside the circle's own edge, not outside it),
            no flag glyph on the node itself. */}
        <div className={`${NODE_SIZE_YEAR} shrink-0 rounded-full ${
          foundedYear == null ? 'border-2 border-dashed border-amber-300 bg-white' : 'bg-amber-500 ring-[3px] ring-inset ring-white'
        }`} />
        {/* Founding has already happened, by definition — this segment is
            always "past", never the future/dashed style. */}
        <AxisLine fromColor={FOUNDED_NODE_COLOR} toColor={nextColor} solid />
      </div>
      {/* §B.7 — centered on the NODE's own flush-left position (a fixed
          box exactly NODE_SIZE_YEAR wide, pinned to the column's left edge
          via justify-start), not the column's full center — that's what
          left the "2022" label drifting right after §A (Prompt 177)
          removed the leading line segment that used to keep the node
          itself centered instead of flush-left. */}
      <div style={{ ...colStyle, gridRow: ROW_LABEL }} className={`mt-1 flex ${CONTAINER_WIDTH} justify-start`}>
        <span className={`${NODE_SIZE_YEAR} shrink-0 whitespace-nowrap text-center text-xs font-medium text-amber-700`}>
          {foundedYear ?? '—'}
        </span>
      </div>
    </>
  );
}

function MilestoneNode<T extends RoadmapPeriod & { items: string[]; items_v2?: RoadmapItemV2[] | null }>({
  m, index, col, theme, editable, onEdit, onRemove, now, prevPast, prevColor, nextColor, categories = [], isRowStart = false,
}: {
  m: T; index: number; col: number; theme: typeof CARD_THEMES[number]; editable: boolean; onEdit?: (m: T) => void; onRemove?: (m: T) => void; now: Date;
  // Prompt 213 §D — para a cor do ponto de cada item. Opcional: sem
  // categorias (ou num item General/lookup-miss) o ponto fica na cor do
  // tema, exactamente o comportamento anterior.
  categories?: RoadmapCategory[];
  // Prompt 177 §1 — whether the PREVIOUS node on the axis was already past,
  // so this node's own "before" segment agrees with that neighbor's
  // "after" segment (both sides of one physical line draw the same style —
  // see the header note's algebra) instead of each node guessing from its
  // own status alone, which would split every transition segment in two.
  prevPast: boolean;
  // Prompt 194 — the two neighboring nodes' colors (Founded's amber, or a
  // CARD_THEMES hex), so this node's own two AxisLine halves can gradient
  // toward them. nextColor falls back to this node's OWN color when it's
  // the last milestone — nothing further to blend toward.
  prevColor: string; nextColor: string;
  // Prompt 327 Pedido C — true for the first node of a WRAPPED row that
  // isn't the overall first milestone: no incoming line is drawn, same
  // "nothing precedes the very first node" treatment FoundedNode's own
  // comment already documents — a wrapped row starts fresh, it doesn't
  // pretend to continue a line from the row above.
  isRowStart?: boolean;
}) {
  const label = periodLabel(m.period_kind, m.period_year, m.period_quarter);
  const past = periodHasPassed(m, now);
  const top = index % 2 === 0;
  const nodeSize = m.period_kind === 'year' ? NODE_SIZE_YEAR : NODE_SIZE_QUARTER;
  const colStyle = { gridColumn: col };
  const card = (
    <div className={`${CARD_WIDTH} rounded-xl p-3.5 text-sm shadow-sm ${theme.bg}`}>
      <div className="flex items-center justify-between gap-1.5">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${theme.badge}`}>{label}</span>
        {/* Prompt 175 §B.2 — the axis's own past/future signal, repeated
            inside the card so the state reads without following the line
            down to the node. */}
        <span aria-hidden="true"
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold text-white ${past ? theme.statusOn : theme.statusOff}`}>
          {past ? '✓' : ''}
        </span>
      </div>
      {readItems(m).length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {readItems(m).map((it, i) => {
            const label = itemCategoryLabel(it, categories);
            const cat = categories.find((c) => c.label === label);
            const dot = cat ? (COLOR_STYLES[cat.color as CategoryColor]?.dot ?? theme.dot) : theme.dot;
            const shape = cat ? (SHAPE_STYLES[cat.shape as CategoryShape] ?? 'rounded-full') : 'rounded-full';
            return (
              <li key={i} className="flex items-start gap-1.5 text-gray-700">
                <span title={cat ? label : undefined}
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 ${shape} ${dot}`} aria-hidden="true" />
                <span>{it.text}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-gray-400">No milestones listed.</p>
      )}
      {editable && (
        <div className="mt-2.5 flex justify-end gap-2 border-t border-black/5 pt-1.5 text-xs text-gray-500">
          <button onClick={() => onEdit?.(m)} className="hover:text-gray-800">Edit</button>
          <button onClick={() => onRemove?.(m)} className="hover:text-[#B00000]">Remove</button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div style={{ ...colStyle, gridRow: ROW_TOP_CARD }} className={`flex ${CONTAINER_WIDTH} flex-col items-center justify-end`}>
        {top && <>{card}<CardTriangle colorClass={theme.triangleDown} /></>}
      </div>
      <div style={{ ...colStyle, gridRow: ROW_AXIS }} className={`flex ${CONTAINER_WIDTH} items-center`}>
        {!isRowStart && <AxisLine fromColor={prevColor} toColor={theme.nodeColor} solid={prevPast} />}
        {/* §B.6 — filled + thin border when past, hollow (white fill,
            thicker border so the "empty" ring reads clearly) when future.
            Prompt 194 — the color itself is now this node's own theme hex
            (was a fixed #0E7490/cyan-300 pair), same value either way; only
            fill-vs-outline still tracks past/future. */}
        <div className={`${nodeSize} shrink-0 rounded-full ${past ? 'border-2' : 'border-[3px] bg-white'}`}
          style={{ borderColor: theme.nodeColor, backgroundColor: past ? theme.nodeColor : undefined }} />
        <AxisLine fromColor={theme.nodeColor} toColor={nextColor} solid={past} />
      </div>
      <div style={{ ...colStyle, gridRow: ROW_LABEL }} className={`mt-1 flex ${CONTAINER_WIDTH} justify-center text-xs text-gray-500`}>
        {label}
      </div>
      <div style={{ ...colStyle, gridRow: ROW_BOTTOM_CARD }} className={`flex ${CONTAINER_WIDTH} flex-col items-center justify-start`}>
        {!top && <><CardTriangle colorClass={theme.triangleUp} />{card}</>}
      </div>
    </>
  );
}

// Prompt 327 Pedido C — the horizontal-scroll carousel (ScrollBar, drag-to-
// scroll, wheel-to-scroll) is gone: the timeline must always fit the page,
// never a horizontal scrollbar, however many milestones exist. It now WRAPS
// into as many rows as needed instead of scrolling sideways — each row is
// its own self-contained grid (same 4-shared-rows structure §A already
// established, so the axis stays level within a row), stacked vertically.
// A row that isn't the first gets no incoming line into its own first node
// (isRowStart) — same "nothing precedes the very first node" treatment
// FoundedNode's comment already documents; a wrapped row starts fresh, it
// never pretends to visually continue the row above it.
//
// COLUMN_WIDTH_PX must track CONTAINER_WIDTH's own px value (w-60 = 15rem);
// used only to size how many columns fit one row via ResizeObserver — real
// layout width still comes from Tailwind classes, this is just the sizing
// math for chunking.
const COLUMN_WIDTH_PX = 240;

function useColumnsPerRow(containerRef: React.RefObject<HTMLDivElement>): number {
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setColumns(Math.max(2, Math.floor(width / COLUMN_WIDTH_PX)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);
  return columns;
}

export function RoadmapTimeline<T extends RoadmapPeriod & { items: string[]; items_v2?: RoadmapItemV2[] | null }>({
  foundedYear, milestones, editable, onAddClick, onEditClick, onRemoveClick, now = new Date(), categories = [],
}: {
  foundedYear: number | null;
  milestones: T[];
  editable: boolean;
  categories?: RoadmapCategory[];
  onAddClick?: () => void;
  onEditClick?: (m: T) => void;
  onRemoveClick?: (m: T) => void;
  now?: Date;
}) {
  const sorted = sortRoadmapPeriods(milestones);
  const containerRef = useRef<HTMLDivElement>(null);
  const columnsPerRow = useColumnsPerRow(containerRef);

  // The first row reserves one column for Founded; every row after that is
  // pure milestones. Chunking never depends on scroll width — the row
  // count that fits is measured once via ResizeObserver, not discovered by
  // overflowing and scrolling.
  const firstRowCount = Math.max(1, columnsPerRow - 1);
  const rows: T[][] = [];
  if (sorted.length <= firstRowCount) {
    rows.push(sorted);
  } else {
    rows.push(sorted.slice(0, firstRowCount));
    for (let i = firstRowCount; i < sorted.length; i += columnsPerRow) rows.push(sorted.slice(i, i + columnsPerRow));
  }

  let globalIndex = 0;

  return (
    <div ref={containerRef} className="space-y-6">
      {rows.map((row, rowIdx) => {
        const isFirstRow = rowIdx === 0;
        const rowStartIndex = globalIndex;
        globalIndex += row.length;
        return (
          <div key={rowIdx} className="grid grid-flow-col items-stretch" style={{ gridTemplateRows: 'repeat(4, auto)' }}>
            {isFirstRow && (
              <FoundedNode foundedYear={foundedYear} col={1}
                nextColor={row.length > 0 ? CARD_THEMES[0 % CARD_THEMES.length].nodeColor : FOUNDED_NODE_COLOR} />
            )}
            {row.map((m, iInRow) => {
              const i = rowStartIndex + iInRow;
              const isRowStart = !isFirstRow && iInRow === 0;
              return (
                <MilestoneNode key={`${m.period_kind}:${m.period_year}:${m.period_quarter ?? ''}`}
                  m={m} index={i + 1} col={isFirstRow ? iInRow + 2 : iInRow + 1} theme={CARD_THEMES[i % CARD_THEMES.length]}
                  editable={editable} onEdit={onEditClick} onRemove={onRemoveClick} now={now} categories={categories}
                  isRowStart={isRowStart}
                  prevPast={i === 0 ? true : periodHasPassed(sorted[i - 1], now)}
                  prevColor={i === 0 ? FOUNDED_NODE_COLOR : CARD_THEMES[(i - 1) % CARD_THEMES.length].nodeColor}
                  nextColor={i === sorted.length - 1 ? CARD_THEMES[i % CARD_THEMES.length].nodeColor : CARD_THEMES[(i + 1) % CARD_THEMES.length].nodeColor} />
              );
            })}
          </div>
        );
      })}
      {editable && (
        <button onClick={onAddClick}
          className="flex items-center gap-2 rounded-xl border-2 border-dashed border-cyan-300 px-3 py-2 text-xs font-medium text-[#0E7490] hover:bg-cyan-50">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-cyan-300 text-base font-bold">+</span>
          Add milestone
        </button>
      )}
    </div>
  );
}

// Prompt 213 §D — itemCats alinha por INDICE DE LINHA com o itemsText: a
// linha N do textarea tem a categoria N. Frágil se as linhas forem
// reordenadas dentro do textarea, e aceite: o editor re-alinha a cada
// tecla (linhas a mais ganham null=General, a menos são cortadas), e a
// alternativa — um editor por-item com drag — era outra UI inteira.
interface MilestoneDraft { period_kind: RoadmapPeriodKind; period_year: string; period_quarter: string; itemsText: string; itemCats: (string | null)[] }
const BLANK_DRAFT: MilestoneDraft = { period_kind: 'quarter', period_year: '', period_quarter: '1', itemsText: '', itemCats: [] };

function draftFromMilestone(m: RoadmapMilestone): MilestoneDraft {
  // readItems: items_v2 quando existe, senão o legacy como General — a
  // conversão lazy da 0177 do lado do editor.
  const structured = readItems(m);
  return {
    period_kind: m.period_kind, period_year: String(m.period_year),
    period_quarter: String(m.period_quarter ?? 1),
    itemsText: structured.map((i) => i.text).join('\n'),
    itemCats: structured.map((i) => i.category_id),
  };
}

function itemsV2FromDraft(d: MilestoneDraft): RoadmapItemV2[] {
  return d.itemsText.split('\n').map((t) => t.trim()).filter(Boolean)
    .map((text, i) => ({ text, category_id: d.itemCats[i] ?? null }));
}

function MilestoneForm({ draft, setDraft, onSave, onCancel, saving, err, categories }: {
  draft: MilestoneDraft; setDraft: (d: MilestoneDraft) => void;
  onSave: () => void; onCancel: () => void; saving: boolean; err: string;
  categories: RoadmapCategory[];
}) {
  const yearNum = Number(draft.period_year);
  const yearValid = draft.period_year.trim() !== '' && Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-cyan-100 bg-cyan-50/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={draft.period_kind} onChange={(e) => setDraft({ ...draft, period_kind: e.target.value as RoadmapPeriodKind })}
          className="rounded border border-gray-300 px-2 py-1 text-sm">
          <option value="quarter">Quarter</option>
          <option value="year">Year</option>
        </select>
        <input type="number" value={draft.period_year} onChange={(e) => setDraft({ ...draft, period_year: e.target.value })}
          placeholder="Year (e.g. 2026)" className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
        {draft.period_kind === 'quarter' && (
          <select value={draft.period_quarter} onChange={(e) => setDraft({ ...draft, period_quarter: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm">
            {QUARTERS.map((q) => <option key={q} value={q}>Q{q}</option>)}
          </select>
        )}
      </div>
      <textarea value={draft.itemsText} onChange={(e) => setDraft({ ...draft, itemsText: e.target.value })} rows={3}
        placeholder={'One milestone per line, e.g.\nScale to 50 customers\nOpen UK market'}
        className="w-full rounded border border-gray-300 p-2 text-sm" />
      {/* Prompt 213 §D — categoria por linha. Só aparece quando há
          categorias criadas: sem elas, tudo é General e o select era
          mobiliário. */}
      {categories.length > 0 && draft.itemsText.trim() !== '' && (
        <div className="space-y-1">
          {draft.itemsText.split('\n').map((t) => t.trim()).filter(Boolean).map((line, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-gray-600">{line}</span>
              <select value={draft.itemCats[i] ?? ''}
                onChange={(e) => {
                  const next = [...draft.itemCats];
                  next[i] = e.target.value || null;
                  setDraft({ ...draft, itemCats: next });
                }}
                className="rounded border border-gray-300 px-1.5 py-0.5 text-xs">
                <option value="">{GENERAL_LABEL}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {!yearValid && draft.period_year.trim() !== '' && <p className="text-xs text-[#B00000]">Year must be between 2000 and 2100.</p>}
      {err && <p className="text-xs text-[#B00000]">{err}</p>}
      <div className="flex gap-2">
        <button disabled={!yearValid || saving} onClick={onSave}
          className="rounded bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-3 py-1.5 text-xs">Cancel</button>
      </div>
    </div>
  );
}

export function RoadmapCard({ canEdit, available }: { canEdit: boolean; available: boolean }) {
  const { db, updateOrg, addRoadmapMilestone, updateRoadmapMilestone, removeRoadmapMilestone, addFundingRound } = useStore();

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<MilestoneDraft>(BLANK_DRAFT);
  const [addErr, setAddErr] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MilestoneDraft>(BLANK_DRAFT);
  const [editErr, setEditErr] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  // Prompt 212 §B.4 — uma ronda passada escrita como milestone. Nunca
  // automatico: guarda-se a sugestao e o founder confirma.
  const [pastRound, setPastRound] = useState<(PastRoundHint & { line: string }) | null>(null);

  if (!available) return null;

  async function acceptPastRound() {
    if (!pastRound) return;
    await addFundingRound({ label: pastRound.suggestedLabel, amount_eur: pastRound.amountEur });
    setPastRound(null);
  }

  function itemsFromText(text: string): string[] {
    return text.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async function submitAdd() {
    const items = itemsFromText(addDraft.itemsText);
    setAddSaving(true); setAddErr('');
    try {
      // items E items_v2, sempre os dois: o texto plano continua a servir
      // qualquer leitor antigo, e o estruturado é a fonte das categorias.
      const { error } = await addRoadmapMilestone({
        period_kind: addDraft.period_kind, period_year: Number(addDraft.period_year),
        period_quarter: addDraft.period_kind === 'quarter' ? Number(addDraft.period_quarter) : undefined,
        items, items_v2: itemsV2FromDraft(addDraft),
      });
      if (error) { setAddErr(error); return; }

      // §B.4 — le as linhas gravadas a procura de "isto ja aconteceu".
      // Exige montante + termo de ronda + prova de passado (ver
      // round-propagation.ts): "Raise €300k seed" e o PLANO e nao dispara.
      const year = Number(addDraft.period_year);
      for (const line of items) {
        const hint = detectPastRound(line, { periodYear: year, currentYear: new Date().getFullYear() });
        if (hint) { setPastRound({ ...hint, line }); break; }
      }

      setAdding(false); setAddDraft(BLANK_DRAFT);
    } finally { setAddSaving(false); }
  }

  function startEdit(m: RoadmapMilestone) {
    setEditDraft(draftFromMilestone(m));
    setEditErr('');
    setEditingId(m.id);
  }
  async function submitEdit() {
    if (!editingId) return;
    const items = itemsFromText(editDraft.itemsText);
    setEditSaving(true); setEditErr('');
    try {
      const { error } = await updateRoadmapMilestone(editingId, {
        period_kind: editDraft.period_kind, period_year: Number(editDraft.period_year),
        period_quarter: editDraft.period_kind === 'quarter' ? Number(editDraft.period_quarter) : undefined,
        items, items_v2: itemsV2FromDraft(editDraft),
      });
      if (error) { setEditErr(error); return; }
      setEditingId(null);
    } finally { setEditSaving(false); }
  }

  return (
    <>
      {pastRound && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="min-w-0 flex-1">
            &ldquo;{pastRound.line}&rdquo; looks like a round you already closed. Record{' '}
            <strong>€{pastRound.amountEur.toLocaleString('en-US')}</strong> under Previous funding? It will show on your
            profile, the investor dossier and your next review.
          </span>
          <button onClick={acceptPastRound}
            className="whitespace-nowrap rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white">
            Add to Previous funding
          </button>
          <button onClick={() => setPastRound(null)} className="text-[11px] text-gray-500 hover:underline">No thanks</button>
        </div>
      )}
    <Card title={<span className="inline-flex items-center gap-1">Roadmap <TermHint text="Key milestones and goals for the journey ahead." /></span>}>
      {/* id targeted by the "Turn on →" link on the founder-only dossier
          preview page (Prompt 306) when this toggle is off. */}
      <div id="roadmap-visibility-toggle" className="mb-2 flex scroll-mt-16 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-gray-400">Key milestones and goals for the journey ahead.</p>
          {/* Prompt 327 Pedido E — gated on a completed Readiness & Train
              analysis; never applies a suggestion automatically, opens the
              existing add-milestone form pre-filled for the founder to
              review, edit the period, and save (or discard). */}
          {canEdit && (
            <AiSupportButton kind="roadmap" onUse={(s) => { setAddDraft({ ...BLANK_DRAFT, itemsText: s }); setAdding(true); setEditingId(null); }} />
          )}
        </div>
        {canEdit && (
          <Toggle checked={db.org.roadmap_visible_to_investors ?? true}
            onChange={(v) => updateOrg({ roadmap_visible_to_investors: v })}
            label={
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                Let investors you&apos;re in contact with see this roadmap
                <TermHint text="Visible to any investor at level 1+ (they've expressed interest or you've granted access) once this is on." />
              </span>
            } />
        )}
      </div>

      <RoadmapTimeline
        foundedYear={db.org.founded_year ?? null}
        milestones={db.roadmapMilestones}
        editable={canEdit}
        onAddClick={() => { setAdding(true); setEditingId(null); }}
        onEditClick={startEdit}
        onRemoveClick={(m) => { if (window.confirm('Remove this milestone?')) removeRoadmapMilestone(m.id); }}
        categories={db.roadmapCategories}
      />

      {adding && (
        <MilestoneForm draft={addDraft} setDraft={setAddDraft} onSave={submitAdd}
          onCancel={() => { setAdding(false); setAddDraft(BLANK_DRAFT); setAddErr(''); }}
          saving={addSaving} err={addErr} categories={db.roadmapCategories} />
      )}
      {editingId && (
        <MilestoneForm draft={editDraft} setDraft={setEditDraft} onSave={submitEdit}
          onCancel={() => { setEditingId(null); setEditErr(''); }}
          saving={editSaving} err={editErr} categories={db.roadmapCategories} />
      )}

      {/* Prompt 213 §D — o gestor de categorias do founder. Nome livre
          (é onde a liberdade vale alguma coisa); cor e forma de conjuntos
          fechados, porque cor livre acabava em roadmaps arco-íris. */}
      {canEdit && <CategoryManager />}
    </Card>
    </>
  );
}

function CategoryManager() {
  const { db, addRoadmapCategory, removeRoadmapCategory } = useStore();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<CategoryColor>('teal');
  const [shape, setShape] = useState<CategoryShape>('rounded');

  return (
    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
      <p className="text-xs font-medium text-gray-600">Event categories</p>
      <p className="mt-0.5 text-[11px] text-gray-400">
        Tag milestones so investors can filter your roadmap — rounds, prototype, GTM, whatever fits.
        Untagged items read as {GENERAL_LABEL}.
      </p>

      {db.roadmapCategories.length > 0 && (
        <ul className="mt-2 space-y-1">
          {db.roadmapCategories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-xs">
              <span aria-hidden
                className={`h-3 w-3 shrink-0 ${COLOR_STYLES[c.color as CategoryColor]?.dot ?? 'bg-gray-400'} ${SHAPE_STYLES[c.shape as CategoryShape] ?? 'rounded-lg'}`} />
              <span className="text-gray-700">{c.label}</span>
              {/* Apagar é seguro sem confirmação pesada: os itens que
                  apontavam para cá passam a ler-se General — nada se perde
                  além da etiqueta (contrato da 0177). */}
              <button onClick={() => removeRoadmapCategory(c.id)}
                className="ml-auto text-[11px] text-gray-400 hover:text-[#B00000]">remove</button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Investment rounds"
          className="w-44 rounded border border-gray-300 px-2 py-1 text-xs" />
        <select value={color} onChange={(e) => setColor(e.target.value as CategoryColor)}
          className="rounded border border-gray-300 px-1.5 py-1 text-xs">
          {CATEGORY_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={shape} onChange={(e) => setShape(e.target.value as CategoryShape)}
          className="rounded border border-gray-300 px-1.5 py-1 text-xs">
          {CATEGORY_SHAPES.map((sh) => <option key={sh} value={sh}>{sh}</option>)}
        </select>
        <span aria-hidden className={`h-3.5 w-3.5 ${COLOR_STYLES[color].dot} ${SHAPE_STYLES[shape]}`} />
        <button
          disabled={!label.trim()}
          onClick={async () => { await addRoadmapCategory({ label: label.trim(), color, shape }); setLabel(''); }}
          className="rounded bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
          Add
        </button>
      </div>
    </div>
  );
}
