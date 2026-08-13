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
import { Card, TermHint, Toggle } from '@/components/ui';
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
const CARD_THEMES = [
  {
    bg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500',
    statusOn: 'border-emerald-500 bg-emerald-500', statusOff: 'border-emerald-300 bg-white text-emerald-300',
    triangleDown: 'border-t-8 border-t-emerald-50', triangleUp: 'border-b-8 border-b-emerald-50',
  },
  {
    bg: 'bg-blue-50', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500',
    statusOn: 'border-blue-500 bg-blue-500', statusOff: 'border-blue-300 bg-white text-blue-300',
    triangleDown: 'border-t-8 border-t-blue-50', triangleUp: 'border-b-8 border-b-blue-50',
  },
  {
    bg: 'bg-purple-50', badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500',
    statusOn: 'border-purple-500 bg-purple-500', statusOff: 'border-purple-300 bg-white text-purple-300',
    triangleDown: 'border-t-8 border-t-purple-50', triangleUp: 'border-b-8 border-b-purple-50',
  },
];
const FOUNDED_TRIANGLE_DOWN = 'border-t-8 border-t-amber-50';

// Prompt 185 §B.4 — a small CSS-border triangle (zero-size box, two
// transparent side-borders + one colored border) pointing at the node it
// belongs to: `border-t-*` for a card sitting ABOVE the axis (colored top
// edge, point hangs down toward the line), `border-b-*` for a card BELOW
// it (colored bottom edge, point rises up toward the line).
function CardTriangle({ colorClass }: { colorClass: string }) {
  return <div aria-hidden="true" className={`mx-auto mb-1 h-0 w-0 border-x-8 border-x-transparent ${colorClass}`} />;
}

// Prompt 177 §1 / Prompt 185 §B.3 — one shared line-segment renderer:
// `solid` true draws the "already happened" half (a filled 2px bar); false
// draws the "still ahead" half as a genuinely DASHED border, in the SAME
// teal family as the solid half (a lighter tint), not a neutral gray — the
// reference image is solid-then-dashed within one color, not two colors.
function AxisLine({ solid }: { solid: boolean }) {
  return solid
    ? <div className="h-0.5 flex-1 bg-[#0E7490]" />
    : <div className="h-0 flex-1 border-t-2 border-dashed border-cyan-300" />;
}

// Prompt 185 §A — each node contributes explicitly grid-positioned cells
// (grid-column pins it to its own slot in the timeline; grid-row picks
// which of the 4 shared rows) instead of a single self-contained flex
// column — see the file header for why that's what actually keeps every
// column's axis row level with its neighbors regardless of card height.
function FoundedNode({ foundedYear, col }: { foundedYear: number | null; col: number }) {
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
        <AxisLine solid />
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

function MilestoneNode<T extends RoadmapPeriod & { items: string[] }>({
  m, index, col, theme, editable, onEdit, onRemove, now, prevPast,
}: {
  m: T; index: number; col: number; theme: typeof CARD_THEMES[number]; editable: boolean; onEdit?: (m: T) => void; onRemove?: (m: T) => void; now: Date;
  // Prompt 177 §1 — whether the PREVIOUS node on the axis was already past,
  // so this node's own "before" segment agrees with that neighbor's
  // "after" segment (both sides of one physical line draw the same style —
  // see the header note's algebra) instead of each node guessing from its
  // own status alone, which would split every transition segment in two.
  prevPast: boolean;
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
      {m.items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {m.items.map((it, i) => (
            <li key={i} className="flex items-start gap-1.5 text-gray-700">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${theme.dot}`} aria-hidden="true" />
              <span>{it}</span>
            </li>
          ))}
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
        <AxisLine solid={prevPast} />
        {/* §B.6 — filled + thin border when past, hollow (white fill,
            thicker border so the "empty" ring reads clearly) when future. */}
        <div className={`${nodeSize} shrink-0 rounded-full ${
          past ? 'border-2 border-[#0E7490] bg-[#0E7490]' : 'border-[3px] border-cyan-300 bg-white'
        }`} />
        <AxisLine solid={past} />
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

// Prompt 177 §3 / Prompt 185 §A.2 — a slim scrollbar-style bar below the
// row of cards: thin track, a thumb sized/positioned from the real
// scrollLeft/scrollWidth/clientWidth, small chevrons at each end (the
// reference confirms all of this stays — Prompt 185 §B.8). New in 185: the
// thumb is actually DRAGGABLE (pointer events, not just clickable
// chevrons), and clicking anywhere else on the track jumps to that
// position — the chevrons' fixed 320px-per-click alone could leave
// "Add milestone" unreachable with several milestones in the row.
function ScrollBar({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement> }) {
  const [thumb, setThumb] = useState({ left: 0, width: 100 });
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startClientX: number; startScrollLeft: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function update() {
      const { scrollLeft, scrollWidth, clientWidth } = el!;
      if (scrollWidth <= 0) return;
      setThumb({
        left: (scrollLeft / scrollWidth) * 100,
        width: Math.max(8, (clientWidth / scrollWidth) * 100),
      });
    }
    update();
    el.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [scrollRef]);

  function scrollBy(dir: -1 | 1) {
    scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  }

  function onThumbPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { startClientX: e.clientX, startScrollLeft: el.scrollLeft };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onThumbPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track || !dragRef.current) return;
    const trackWidth = track.getBoundingClientRect().width;
    if (trackWidth <= 0) return;
    const dx = e.clientX - dragRef.current.startClientX;
    el.scrollLeft = dragRef.current.startScrollLeft + dx * (el.scrollWidth / trackWidth);
  }
  function onThumbPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  // Click anywhere on the track (not a drag) jumps the viewport so its
  // center lands under the click.
  function onTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track || e.target !== track) return;
    const rect = track.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    el.scrollLeft = ratio * el.scrollWidth - el.clientWidth / 2;
  }

  return (
    <div className="mt-2 flex items-center gap-2 px-1">
      <button type="button" onClick={() => scrollBy(-1)} aria-label="Scroll timeline left"
        className="shrink-0 text-sm text-gray-400 hover:text-[#0E7490]">
        ‹
      </button>
      <div ref={trackRef} onClick={onTrackClick} className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-gray-100">
        <div
          onPointerDown={onThumbPointerDown} onPointerMove={onThumbPointerMove} onPointerUp={onThumbPointerUp}
          className="absolute top-0 h-1.5 cursor-grab touch-none rounded-full bg-gray-300 active:cursor-grabbing"
          style={{ left: `${thumb.left}%`, width: `${thumb.width}%` }} />
      </div>
      <button type="button" onClick={() => scrollBy(1)} aria-label="Scroll timeline right"
        className="shrink-0 text-sm text-gray-400 hover:text-[#0E7490]">
        ›
      </button>
    </div>
  );
}

export function RoadmapTimeline<T extends RoadmapPeriod & { items: string[] }>({
  foundedYear, milestones, editable, onAddClick, onEditClick, onRemoveClick, now = new Date(),
}: {
  foundedYear: number | null;
  milestones: T[];
  editable: boolean;
  onAddClick?: () => void;
  onEditClick?: (m: T) => void;
  onRemoveClick?: (m: T) => void;
  now?: Date;
}) {
  const sorted = sortRoadmapPeriods(milestones);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Prompt 185 §A.2 — maps vertical mouse-wheel motion onto horizontal
  // scroll, the standard pattern for a horizontal-only carousel/timeline
  // (a plain trackpad/mouse wheel does nothing on an x-only overflow box
  // by default). Only takes over when the gesture is more vertical than
  // horizontal, so a trackpad's own native horizontal swipe (already
  // deltaX-dominant) passes through untouched. Native `addEventListener`
  // with `{ passive: false }`, not onWheel — React's synthetic wheel
  // listener is passive by default in recent versions, so
  // preventDefault() inside an onWheel prop is silently ignored.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el!.scrollLeft += e.deltaY;
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Prompt 185 §A — column 1 is always Founded; milestones take 2..N+1;
  // the "Add milestone" button (editable only) takes the last column.
  const addCol = sorted.length + 2;

  return (
    <div>
      {/* Native scrollbar hidden — ScrollBar below is the only scroll
          indicator, matching the reference having exactly one. A CSS grid,
          not a flex row — see the file header for why: only a shared grid
          row (not independent per-column flex stretch) keeps the axis line
          level across columns whose card heights differ. */}
      <div ref={scrollRef}
        className="grid grid-flow-col items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ gridTemplateRows: 'repeat(4, auto)' }}>
        <FoundedNode foundedYear={foundedYear} col={1} />
        {sorted.map((m, i) => (
          <MilestoneNode key={`${m.period_kind}:${m.period_year}:${m.period_quarter ?? ''}`}
            m={m} index={i + 1} col={i + 2} theme={CARD_THEMES[i % CARD_THEMES.length]}
            editable={editable} onEdit={onEditClick} onRemove={onRemoveClick} now={now}
            prevPast={i === 0 ? true : periodHasPassed(sorted[i - 1], now)} />
        ))}
        {editable && (
          <div style={{ gridColumn: addCol, gridRow: ROW_AXIS }} className="flex w-28 flex-col items-center justify-center">
            <button onClick={onAddClick}
              className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-dashed border-cyan-300 text-xl font-bold text-[#0E7490] hover:bg-cyan-50">
              +
            </button>
            <span className="mt-1 text-xs font-medium text-[#0E7490]">Add milestone</span>
          </div>
        )}
      </div>
      <ScrollBar scrollRef={scrollRef} />
    </div>
  );
}

interface MilestoneDraft { period_kind: RoadmapPeriodKind; period_year: string; period_quarter: string; itemsText: string }
const BLANK_DRAFT: MilestoneDraft = { period_kind: 'quarter', period_year: '', period_quarter: '1', itemsText: '' };

function draftFromMilestone(m: RoadmapMilestone): MilestoneDraft {
  return {
    period_kind: m.period_kind, period_year: String(m.period_year),
    period_quarter: String(m.period_quarter ?? 1), itemsText: m.items.join('\n'),
  };
}

function MilestoneForm({ draft, setDraft, onSave, onCancel, saving, err }: {
  draft: MilestoneDraft; setDraft: (d: MilestoneDraft) => void;
  onSave: () => void; onCancel: () => void; saving: boolean; err: string;
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
  const { db, updateOrg, addRoadmapMilestone, updateRoadmapMilestone, removeRoadmapMilestone } = useStore();

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<MilestoneDraft>(BLANK_DRAFT);
  const [addErr, setAddErr] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MilestoneDraft>(BLANK_DRAFT);
  const [editErr, setEditErr] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  if (!available) return null;

  function itemsFromText(text: string): string[] {
    return text.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async function submitAdd() {
    const items = itemsFromText(addDraft.itemsText);
    setAddSaving(true); setAddErr('');
    try {
      const { error } = await addRoadmapMilestone({
        period_kind: addDraft.period_kind, period_year: Number(addDraft.period_year),
        period_quarter: addDraft.period_kind === 'quarter' ? Number(addDraft.period_quarter) : undefined,
        items,
      });
      if (error) { setAddErr(error); return; }
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
        items,
      });
      if (error) { setEditErr(error); return; }
      setEditingId(null);
    } finally { setEditSaving(false); }
  }

  return (
    <Card title={<span className="inline-flex items-center gap-1">Roadmap <TermHint text="Key milestones and goals for the journey ahead." /></span>}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-400">Key milestones and goals for the journey ahead.</p>
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
      />

      {adding && (
        <MilestoneForm draft={addDraft} setDraft={setAddDraft} onSave={submitAdd}
          onCancel={() => { setAdding(false); setAddDraft(BLANK_DRAFT); setAddErr(''); }}
          saving={addSaving} err={addErr} />
      )}
      {editingId && (
        <MilestoneForm draft={editDraft} setDraft={setEditDraft} onSave={submitEdit}
          onCancel={() => { setEditingId(null); setEditErr(''); }}
          saving={editSaving} err={editErr} />
      )}
    </Card>
  );
}
