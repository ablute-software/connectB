'use client';
// Prompt 359 Blocks B/C — the roadmap CANVAS: lanes stacked by category,
// time on the X axis, drawn with clicks instead of forms. Shared by founder
// (editable) and investor (read-only) — Block E wires the investor side in
// with `editable={false}` and no callbacks, same "one component, edit vs
// read-only by prop" discipline RoadmapTimeline already established (never
// two roadmaps to keep in sync).
//
// Replaces RoadmapTimeline's per-node-card grid entirely: that layout could
// only ever grow by WRAPPING to a new row (the exact bug this prompt exists
// to kill — see roadmap.ts §327/RoadmapCard.tsx's own history). A lane-based
// canvas has no such failure mode by construction — a lane is one
// continuous line, however many events land on it; density (label -> short
// -> symbol -> cluster) is what shrinks, never the layout wrapping.
import { useMemo, useRef, useState, useEffect } from 'react';
import {
  xFromDate, dateFromX, snapToMonth, clusterByProximity, zoomWindow, visibleLanes,
  matchesTimeToggle, matchesCategoryVisibility, quarterLabel, quartersInRange,
  semesterLabel, semestersInRange, yearLabel, yearsInRange, headerGranularity,
  type ZoomLevel, type TimeToggle, type Cluster,
} from '@/lib/roadmap-canvas';
import { SHAPE_STYLES, GENERAL_LABEL, type CategoryColor, type CategoryShape } from '@/lib/roadmap-categories';
import { isDerivedEvent } from '@/lib/roadmap-derived';
import { CATEGORY_BAR, GLASS_PILL, LABEL_CAPS } from './roadmap-visual';
import type { RoadmapEventStatus } from '@/lib/types';

// Narrower than the full RoadmapCategory (src/lib/types.ts), same discipline
// as CanvasEvent below: the investor side passes RoadmapCategoryFull (no
// `visible` field at all — an investor-facing shape never needs to know a
// category IS toggleable, per Prompt 382 §E) while the founder side passes
// the real RoadmapCategory straight through. `visible` optional and
// defaulting to shown covers both — the investor side's rows are already
// pre-filtered server-side, so it never has an invisible one to represent.
export interface CanvasCategory { id: string; label: string; color: string; shape: string; visible?: boolean }

const LANE_HEIGHT = 56;

// Prompt 386 — PARKED, not fixed: Nuno hit this live on production — the
// "Moved. Undo" toast fired but the event's date never actually persisted.
// This flag short-circuits the whole drag-an-event-to-move-it gesture at
// its one entry point (startDragEvent, below) rather than deleting any of
// the §B.3 code — flip it back on once the real fix lands. Root cause NOT
// confirmed, only the most likely lead, left here for whoever resumes
// this: onCanvasPointerMove fires `onUpdate` on every single pointer-move
// tick during a drag — against localStorage (where this was originally
// verified) that's free; against real Supabase it's a burst of concurrent
// round-trips to the same row, a completely different failure mode. The
// likely fix is moving the event only in local state during the drag and
// persisting once, on pointer-up — but that's a real change to verify,
// not something to sneak in here.
const DRAG_TO_MOVE_ENABLED = false;
const DRAG_THRESHOLD_PX = 5;

export interface CanvasDocOption { id: string; name: string }

// Prompt 359 Block E — the investor side needs to know a document chip is
// visible to THIS investor before showing it (disclosure-aware, fail-closed
// per data-room-investor-view.ts's own contract) — this is resolved by the
// caller (DossierOverviewSections.tsx has the grant list), never guessed
// here. undefined = founder side, where "linked" is enough on its own.
// Prompt 385 — still exported (RoadmapEventDetailPanel's own prop shape
// reuses it), even though RoadmapCanvas itself no longer resolves doc chips.
export interface ResolvedDocChip { name: string; visible: boolean }

// The exact fields this component reads or writes — deliberately narrower
// than the full RoadmapEvent (src/lib/types.ts), which also carries org_id/
// sort_order/created_at/updated_at that nothing here ever touches. A real
// RoadmapEvent satisfies this structurally, so the founder side just passes
// db.roadmapEvents straight through; the investor side (Block E) projects
// its own narrower, disclosure-safe shape without needing a second,
// near-identical canvas component.
export interface CanvasEvent {
  id: string;
  title: string;
  description?: string | null;
  date: string;
  end_date?: string | null;
  status: RoadmapEventStatus;
  category_id?: string | null;
  document_id?: string | null;
  // Prompt 540 RC2 — a projection of org.founded_year, computed at render
  // time and backed by no row. It renders exactly like any other mark in
  // its lane (no new style, per §6) but cannot be dragged, deleted or
  // recategorised, because there is nothing to write.
  derived?: boolean;
}

interface RoadmapCanvasProps {
  events: CanvasEvent[];
  categories: CanvasCategory[];
  foundedYear: number | null;
  editable: boolean;
  onCreate?: (input: { title: string; date: string; end_date?: string | null; status: RoadmapEventStatus; category_id: string | null; date_precision?: 'exact' | 'approx' | 'quarter' }) => Promise<void> | void;
  onUpdate?: (id: string, patch: Partial<CanvasEvent>) => Promise<void> | void;
  now?: Date;
  // Prompt 385 §A.3/§B — selection is lifted: a click on a bar reports up
  // instead of opening a local popover, so the caller can render the detail
  // panel (RoadmapEventDetailPanel) beside Categories, below the canvas, per
  // the mockup's layout — a spot outside this component's own DOM subtree.
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  // Prompt 387 §D.3 — "Add as event" on a question card opens this SAME
  // create popover, pre-filled with a derived title, rather than a second
  // creation flow to keep in sync. Set once by the caller; this component
  // reports back via onPrefillConsumed the instant it's opened the draft,
  // so the caller can clear its own trigger and never re-open it on an
  // unrelated re-render.
  prefillTitle?: string | null;
  onPrefillConsumed?: () => void;
}

interface Lane { id: string; label: string; color: CategoryColor; shape: CategoryShape }
const GENERAL_LANE: Lane = { id: '__general', label: GENERAL_LABEL, color: 'gray', shape: 'rounded' };

function laneFor(categories: CanvasCategory[], categoryId: string | null | undefined): Lane {
  if (!categoryId) return GENERAL_LANE;
  const c = categories.find((x) => x.id === categoryId);
  return c ? { id: c.id, label: c.label, color: c.color as CategoryColor, shape: c.shape as CategoryShape } : GENERAL_LANE;
}

// Prompt 359 §B.1/§B.2 — where a click/drag on empty lane space lands, as a
// pending draft the popover then fills in.
interface DraftEvent { laneId: string; date: string; end_date: string | null; x: number; initialTitle?: string }

function useContainerWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver((entries) => { const w = entries[0]?.contentRect.width; if (w) setWidth(w); });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, width];
}

export function RoadmapCanvas({
  events, categories, foundedYear, editable, onCreate, onUpdate, now = new Date(), selectedId = null, onSelect,
  prefillTitle = null, onPrefillConsumed,
}: RoadmapCanvasProps) {
  const [containerRef, width] = useContainerWidth();
  const [zoom, setZoom] = useState<ZoomLevel>('all');
  // What the year/quarter zoom windows are centered on — defaults to today,
  // but the minimap lets the founder click anywhere to re-center without
  // leaving the zoomed-in level (§C.2, "arrastar o mini-mapa navega").
  const [focus, setFocus] = useState<Date>(now);
  const [timeToggle, setTimeToggle] = useState<TimeToggle>('both');
  const [draft, setDraft] = useState<DraftEvent | null>(null);
  const [dragging, setDragging] = useState<{ id: string; edge?: 'start' | 'end' } | null>(null);
  const [expandedCluster, setExpandedCluster] = useState<{ laneId: string; events: CanvasEvent[]; x: number } | null>(null);

  useEffect(() => {
    if (!prefillTitle || !editable) return;
    setDraft({ laneId: GENERAL_LANE.id, date: now.toISOString().slice(0, 10), end_date: null, x: 0, initialTitle: prefillTitle });
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillTitle]);

  // Domain: from the earlier of (founding year, earliest event) to the
  // later of (today, latest event) plus a little padding — a roadmap with
  // only past events still shows room to plan ahead, and vice versa.
  //
  // Prompt 394 §1 — this used to be computed from `events` (the raw list)
  // regardless of `timeToggle`, so picking "Future" kept the full
  // foundedYear->now span and squeezed the TODAY marker into the far right
  // edge, with no room to plan ahead. "Future" now gets its own domain,
  // anchored near `now` — the other two toggles are unchanged.
  const domain = useMemo(() => {
    if (timeToggle === 'future') {
      const horizon = new Date(now.getTime() + 365 * 86400_000);
      const futureDates = events
        .filter((e) => matchesTimeToggle(e.status, 'future'))
        .flatMap((e) => [new Date(e.date), e.end_date ? new Date(e.end_date) : new Date(e.date)]);
      const max = futureDates.length > 0 ? new Date(Math.max(horizon.getTime(), ...futureDates.map((d) => d.getTime()))) : horizon;
      const paddingMs = Math.max(7 * 86400_000, (max.getTime() - now.getTime()) * 0.05);
      return { start: new Date(now.getTime() - paddingMs), end: new Date(max.getTime() + paddingMs) };
    }
    const dates = events.flatMap((e) => [new Date(e.date), e.end_date ? new Date(e.end_date) : new Date(e.date)]);
    if (foundedYear) dates.push(new Date(Date.UTC(foundedYear, 0, 1)));
    dates.push(now);
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    const paddingMs = Math.max(30 * 86400_000, (max.getTime() - min.getTime()) * 0.05);
    return { start: new Date(min.getTime() - paddingMs), end: new Date(max.getTime() + paddingMs) };
  }, [events, foundedYear, now, timeToggle]);

  const view = zoom === 'all' ? domain : zoomWindow(zoom, focus, domain.start, domain.end);
  const viewWidth = Math.max(width, 1);

  // Prompt 382 §D — two independent cuts on the same list: time toggle and
  // per-category visibility. `lanesUsed` derives from `filtered`, so an off
  // category's lane simply stops existing. `domain` (above) does its own,
  // separate time-toggle handling — Prompt 394 §1 corrected an inaccuracy
  // in this comment: `domain` was never actually derived from `filtered`.
  const filtered = events.filter((e) => matchesTimeToggle(e.status, timeToggle) && matchesCategoryVisibility(e.category_id, categories));

  // Prompt 540 RC1 §4 — every VISIBLE category gets a lane, in founder
  // order, whether or not it holds an event yet; General only when something
  // lands in it. Before this, lanes were derived from the events, so a
  // founder whose five default lanes had just been created saw no lanes at
  // all and had nothing to click on. Prompt 382's toggle still removes a
  // lane when a category is switched off, and an org with zero categories
  // still falls through to the empty state below.
  const lanesUsed = useMemo(() => {
    const { fromCategories, needsGeneral } = visibleLanes(categories, filtered);
    const ordered = fromCategories.map((c) => laneFor(categories, c.id));
    if (needsGeneral) ordered.push(GENERAL_LANE);
    return ordered;
  }, [filtered, categories]);

  function xOf(date: Date) { return xFromDate(date, view.start, view.end, viewWidth); }
  function dateOf(x: number) { return dateFromX(x, view.start, view.end, viewWidth); }

  function eventsForLane(laneId: string) {
    return filtered.filter((e) => laneFor(categories, e.category_id).id === laneId);
  }

  function clustersForLane(laneId: string): Cluster<CanvasEvent>[] {
    const positioned = eventsForLane(laneId).map((e) => ({ item: e, x: xOf(new Date(e.date)) }));
    return clusterByProximity(positioned);
  }

  // ---------------------------------------------------------------------
  // §B.1/§B.2 — click (or click-drag) on empty lane space.
  const pressRef = useRef<{ laneId: string; startX: number; moved: boolean } | null>(null);

  function onLanePointerDown(laneId: string, e: React.PointerEvent<HTMLDivElement>) {
    if (!editable || (e.target as HTMLElement).closest('[data-event-dot]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    pressRef.current = { laneId, startX: e.clientX - rect.left, moved: false };
  }
  function onLanePointerMove(laneId: string, e: React.PointerEvent<HTMLDivElement>) {
    const press = pressRef.current;
    if (!press || press.laneId !== laneId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (Math.abs(x - press.startX) > DRAG_THRESHOLD_PX) press.moved = true;
  }
  function onLanePointerUp(laneId: string, e: React.PointerEvent<HTMLDivElement>) {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || press.laneId !== laneId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const startDate = snapToMonth(dateOf(press.startX));
    const endDate = snapToMonth(dateOf(endX));
    const [d1, d2] = startDate.getTime() <= endDate.getTime() ? [startDate, endDate] : [endDate, startDate];
    setDraft({
      laneId, date: d1.toISOString().slice(0, 10),
      end_date: press.moved && d2.getTime() !== d1.getTime() ? d2.toISOString().slice(0, 10) : null,
      x: (press.startX + endX) / 2,
    });
  }

  // ---------------------------------------------------------------------
  // §B.3 — dragging an existing event to a new date (or resizing a period's
  // edge). A toast-style undo is offered via the previous value kept here.
  // A plain CLICK on an event (to open its detail popover) must never be
  // mistaken for a drag — dragStartXRef + DRAG_THRESHOLD_PX is the same
  // click-vs-drag disambiguation §B.1/§B.2 already use for lane clicks;
  // confirmed live before this guard existed: every click opened the
  // detail popover correctly but ALSO fired an update and showed a
  // "Moved. Undo" toast for a date that never actually changed.
  //
  const [undo, setUndo] = useState<{ id: string; prev: Partial<CanvasEvent> } | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const didMoveRef = useRef(false);

  function startDragEvent(ev: CanvasEvent, edge: 'start' | 'end' | undefined, clientX: number) {
    // Prompt 540 RC2 §3 — a derived mark has no row to update: moving it
    // would fire onUpdate against an id that does not exist. The founding
    // date moves by editing Year founded in About.
    if (isDerivedEvent(ev)) return;
    if (!editable || !DRAG_TO_MOVE_ENABLED) return;
    setDragging({ id: ev.id, edge });
    const rect = containerRef.current?.getBoundingClientRect();
    dragStartXRef.current = rect ? clientX - rect.left : null;
    didMoveRef.current = false;
  }
  function onCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (!didMoveRef.current) {
      if (dragStartXRef.current == null || Math.abs(x - dragStartXRef.current) < DRAG_THRESHOLD_PX) return;
      didMoveRef.current = true;
    }
    const newDate = snapToMonth(dateOf(x)).toISOString().slice(0, 10);
    const ev = events.find((x2) => x2.id === dragging.id);
    if (!ev) return;
    if (dragging.edge === 'end') { void onUpdate?.(ev.id, { end_date: newDate }); }
    else if (dragging.edge === 'start') { void onUpdate?.(ev.id, { date: newDate }); }
    else { void onUpdate?.(ev.id, { date: newDate, end_date: ev.end_date ? shiftEndDate(ev, newDate) : null }); }
  }
  function shiftEndDate(ev: CanvasEvent, newStart: string): string | null {
    if (!ev.end_date) return null;
    const durationMs = new Date(ev.end_date).getTime() - new Date(ev.date).getTime();
    return new Date(new Date(newStart).getTime() + durationMs).toISOString().slice(0, 10);
  }
  function onCanvasPointerUp() {
    if (dragging && didMoveRef.current) {
      const ev = events.find((x) => x.id === dragging.id);
      if (ev) setUndo({ id: ev.id, prev: { date: ev.date, end_date: ev.end_date } });
    }
    setDragging(null);
    dragStartXRef.current = null;
    didMoveRef.current = false;
  }

  const todayX = xOf(now);
  const todayInView = todayX >= 0 && todayX <= viewWidth;

  // Prompt 387 §A — the header ruler picks its own granularity from how
  // much room the CURRENT view actually gives each quarter, never from the
  // total domain — a founder who zooms in with "+" earns quarters back the
  // moment there's space, exactly what Nuno asked for ("até que se aplique
  // '+'"). quartersInRange(view...).length is the real quarter count for
  // THIS window regardless of which granularity ends up rendering.
  const quarterCountInView = viewWidth > 1 ? quartersInRange(view.start, view.end).length : 0;
  const pxPerQuarter = quarterCountInView > 0 ? viewWidth / quarterCountInView : 0;
  const granularity = headerGranularity(pxPerQuarter);
  const headerSpans = viewWidth <= 1 ? []
    : granularity === 'quarter' ? quartersInRange(view.start, view.end)
      : granularity === 'semester' ? semestersInRange(view.start, view.end)
        : yearsInRange(view.start, view.end);
  const currentHeaderLabel = granularity === 'quarter' ? quarterLabel(now.toISOString())
    : granularity === 'semester' ? semesterLabel(now.toISOString())
      : yearLabel(now.toISOString());

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className={`flex overflow-hidden text-xs ${GLASS_PILL}`}>
          {(['past', 'both', 'future'] as TimeToggle[]).map((t) => (
            <button key={t} onClick={() => setTimeToggle(t)}
              className={`px-3 py-1.5 capitalize transition-colors ${timeToggle === t ? 'bg-[#0041c8] text-white' : 'text-[#434656] hover:bg-white/60'}`}>
              {t}
            </button>
          ))}
        </div>
        <div className={`flex items-center gap-0.5 p-0.5 text-xs ${GLASS_PILL}`}>
          <button onClick={() => setZoom('quarter')} aria-label="Zoom in"
            className={`rounded-full px-2.5 py-1.5 ${zoom === 'quarter' ? 'bg-white text-[#0041c8] shadow-sm' : 'text-[#434656] hover:bg-white/60'}`}>−</button>
          <button onClick={() => setZoom('year')} aria-label="Zoom out"
            className={`rounded-full px-2.5 py-1.5 ${zoom === 'year' ? 'bg-white text-[#0041c8] shadow-sm' : 'text-[#434656] hover:bg-white/60'}`}>+</button>
          <button onClick={() => setZoom('all')} className="rounded-full px-2.5 py-1.5 text-[#434656] hover:bg-white/60">Fit</button>
        </div>
      </div>

      {zoom !== 'all' && (
        // Minimap — the full domain, with the current window highlighted;
        // clicking anywhere re-centers the window on that point (§C.2).
        <button type="button" aria-label="Jump to a point in the full timeline"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            setFocus(dateFromX(clickX, domain.start, domain.end, rect.width));
          }}
          className="relative mb-2 h-3 w-full rounded-full bg-[#eaedff]">
          <div className="absolute top-0 h-full rounded-full bg-[#0041c8]/30"
            style={{
              left: `${(xFromDate(view.start, domain.start, domain.end, 100))}%`,
              width: `${Math.max(2, xFromDate(view.end, domain.start, domain.end, 100) - xFromDate(view.start, domain.start, domain.end, 100))}%`,
            }} />
        </button>
      )}

      {/* Prompt 385 §A.4 / 387 §A — the header row; the ACTUAL span reads
          primary text + underline, matching the mockup. Granularity adapts
          (quarter/semester/year) to how much room the view actually has.
          §A.3 — every cell's [left, right) is clamped to [0, viewWidth]: a
          span whose calendar boundary falls outside the view (the very
          first/last one almost always does) must never draw past the
          canvas's own right edge — confirmed live on the real ablute_
          roadmap (2019→2027) that an un-clamped last cell drew ~40px past
          the card's border. */}
      {headerSpans.length > 0 && (
        <div className="mb-1 flex overflow-hidden border-b border-[#c3c5d9]/40 text-[11px]">
          {headerSpans.map((q) => {
            const isActual = q.label === currentHeaderLabel;
            const left = Math.max(0, xOf(q.start));
            const right = Math.min(viewWidth, xOf(q.end));
            return (
              <div key={q.label} className={`relative shrink-0 border-r border-[#c3c5d9]/30 py-1.5 text-center font-semibold uppercase tracking-[0.05em] ${isActual ? 'bg-[#0041c8]/10 text-[#0041c8]' : 'text-[#434656]'}`}
                style={{ width: Math.max(0, right - left) }}>
                {q.label}
                {isActual && <div className="absolute inset-x-0 bottom-0 mx-auto h-[2px] w-8 bg-[#0041c8]" />}
              </div>
            );
          })}
        </div>
      )}

      <div ref={containerRef} className="relative" onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp}>
        {todayInView && (
          <div className="absolute top-0 z-20 h-full border-l-2 border-[#ba1a1a]" style={{ left: todayX }} title="Today">
            <span className={`absolute -top-1 left-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#ba1a1a] px-2 py-0.5 ${LABEL_CAPS} text-[9px] text-white`}>
              TODAY
            </span>
          </div>
        )}
        {lanesUsed.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#434656]/70">
            {editable ? 'Click anywhere below to add your first roadmap event.' : 'Nothing on the roadmap yet.'}
          </p>
        ) : (
          lanesUsed.map((lane) => {
            const clusters = clustersForLane(lane.id);
            return (
              <div key={lane.id} className="relative border-b border-[#c3c5d9]/20"
                style={{ height: LANE_HEIGHT }}
                onPointerDown={(e) => onLanePointerDown(lane.id, e)}
                onPointerMove={(e) => onLanePointerMove(lane.id, e)}
                onPointerUp={(e) => onLanePointerUp(lane.id, e)}>
                <span className="pointer-events-none absolute left-0 top-1 text-[10px] font-medium text-[#434656]/70">{lane.label}</span>
                {clusters.map((c, i) => {
                  const single = c.items.length === 1 ? c.items[0] : null;
                  const endX = single?.end_date ? xOf(new Date(single.end_date)) : null;
                  return (
                    <EventMark key={i} cluster={c} endX={endX} lane={lane} editable={editable}
                      selected={single ? single.id === selectedId : false}
                      onOpenDetail={(ev) => onSelect?.(ev.id)}
                      onExpandCluster={(evs, x) => setExpandedCluster({ laneId: lane.id, events: evs, x })}
                      onStartDrag={startDragEvent} />
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {undo && editable && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-[#c3c5d9]/40 bg-white/60 px-2.5 py-1.5 text-xs text-[#434656]">
          <span>Moved.</span>
          <button onClick={() => { void onUpdate?.(undo.id, undo.prev); setUndo(null); }} className="font-medium text-[#0041c8] hover:underline">Undo</button>
          <button onClick={() => setUndo(null)} className="ml-auto text-[#434656]/60 hover:underline">Dismiss</button>
        </div>
      )}

      {editable && (
        <button onClick={() => setDraft({ laneId: lanesUsed[0]?.id ?? GENERAL_LANE.id, date: now.toISOString().slice(0, 10), end_date: null, x: 0 })}
          className="mt-3 flex items-center gap-2 rounded-xl border-2 border-dashed border-[#0041c8]/30 px-3 py-2 text-xs font-medium text-[#0041c8] hover:bg-[#0041c8]/5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-[#0041c8]/30 text-base font-bold">+</span>
          Add event
        </button>
      )}

      {draft && editable && (
        <CreatePopover draft={draft} categories={categories}
          onCancel={() => setDraft(null)}
          onSave={async (input) => { await onCreate?.(input); setDraft(null); }} />
      )}

      {expandedCluster && (
        <ClusterListPopover events={expandedCluster.events}
          onClose={() => setExpandedCluster(null)}
          onSelect={(ev) => { setExpandedCluster(null); onSelect?.(ev.id); }} />
      )}
    </div>
  );
}

// Prompt 385 §A.1/§A.2 — no title inside a bar or dot, ever: "linhas sem
// nome completo, categoria por cor... quem quer saber o que é cada uma
// carrega nela e abre a descrição" (Nuno's own words). A hover tooltip is
// the bridge between "I see a color" and "I click to read" — the one call
// this prompt explicitly leaves to my judgment, not something Nuno asked
// for outright; kept, not cut.
function EventMark({ cluster, endX, lane, editable, selected, onOpenDetail, onExpandCluster, onStartDrag }: {
  cluster: Cluster<CanvasEvent>; endX: number | null; lane: Lane; editable: boolean; selected: boolean;
  onOpenDetail: (ev: CanvasEvent) => void;
  onExpandCluster: (events: CanvasEvent[], x: number) => void;
  onStartDrag: (ev: CanvasEvent, edge: 'start' | 'end' | undefined, clientX: number) => void;
}) {
  const isCluster = cluster.items.length > 1;
  const barStyle = CATEGORY_BAR[lane.color] ?? CATEGORY_BAR.gray;

  if (isCluster) {
    return (
      <button data-event-dot type="button"
        onClick={() => onExpandCluster(cluster.items, cluster.x)}
        style={{ left: cluster.x }}
        className={`absolute top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[9px] font-bold text-white ${barStyle.barSelected}`}
        title={`${cluster.items.length} events`}>
        {cluster.items.length}
      </button>
    );
  }

  const ev = cluster.items[0];
  const backed = !!ev.document_id;
  const tooltip = ev.end_date ? `${ev.title} (${ev.date} – ${ev.end_date})` : ev.title;

  // A period (has end_date) draws as a thin pill spanning its own [date,
  // end_date] width; a point event draws as a small shape (the category's
  // own dot/diamond/square) at its single date — the mockup's own
  // distinction, never rendered before this prompt (the old dot ignored
  // end_date visually, ONLY the tooltip mentioned it).
  const isPeriod = ev.end_date != null && endX != null;

  return (
    <div data-event-dot className="group absolute top-1/2 -translate-y-1/2" style={{ left: cluster.x }} title={tooltip}>
      {isPeriod ? (
        <button type="button"
          onPointerDown={(e) => { e.stopPropagation(); if (editable) onStartDrag(ev, undefined, e.clientX); }}
          onClick={(e) => { e.stopPropagation(); onOpenDetail(ev); }}
          style={{ width: Math.max(16, (endX as number) - cluster.x) }}
          className={`h-3.5 rounded-full transition-shadow ${selected ? `${barStyle.barSelected} ${barStyle.ring}` : barStyle.bar}`} />
      ) : (
        <button type="button"
          onPointerDown={(e) => { e.stopPropagation(); if (editable) onStartDrag(ev, undefined, e.clientX); }}
          onClick={(e) => { e.stopPropagation(); onOpenDetail(ev); }}
          className={`h-3 w-3 -translate-x-1/2 border-2 ${SHAPE_STYLES[lane.shape] ?? 'rounded-full'} ${
            selected ? `${barStyle.barSelected} border-transparent ${barStyle.ring}`
              : ev.status === 'done' ? `${barStyle.barSelected} border-transparent`
                : `bg-white ${barStyle.text} border-current`
          }`} />
      )}
      {backed && <span className="pointer-events-none absolute -right-1 -top-2 text-[9px]" title="Backed by a document">✓</span>}
      {/* Prompt 385 §A.2 — hover tooltip: the native `title` on the wrapper
          above already covers it; this is the one visible-on-hover text
          affordance, shown only via group-hover so the bar itself stays
          bare per §A.1. */}
      <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded bg-[#131b2e] px-1.5 py-0.5 text-[10px] text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 z-30">
        {ev.title}
      </span>
    </div>
  );
}

function CreatePopover({ draft, categories, onCancel, onSave }: {
  draft: DraftEvent; categories: CanvasCategory[];
  onCancel: () => void;
  onSave: (input: { title: string; date: string; end_date?: string | null; status: RoadmapEventStatus; category_id: string | null; date_precision?: 'exact' | 'approx' | 'quarter' }) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(draft.initialTitle ?? '');
  const [date, setDate] = useState(draft.date);
  const [endDate, setEndDate] = useState(draft.end_date ?? '');
  const [categoryId, setCategoryId] = useState<string>(draft.laneId === GENERAL_LANE.id ? '' : draft.laneId);
  const [saving, setSaving] = useState(false);
  const defaultStatus: RoadmapEventStatus = new Date(date) < new Date() ? 'done' : 'planned';
  const [status, setStatus] = useState<RoadmapEventStatus>(defaultStatus);

  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-[#0041c8]/15 bg-[#eaedff]/50 p-3">
      <input autoComplete="off" autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="What happened (or will happen)?"
        onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) void submit(); }}
        className="w-full rounded-lg border border-[#c3c5d9] px-2 py-1.5 text-sm" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">Date <input autoComplete="off" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-[#c3c5d9] px-1.5 py-1" /></label>
        <label className="flex items-center gap-1">
          End (optional) <input autoComplete="off" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-[#c3c5d9] px-1.5 py-1" />
        </label>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="rounded-lg border border-[#c3c5d9] px-1.5 py-1">
          <option value="">{GENERAL_LABEL}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as RoadmapEventStatus)} className="rounded-lg border border-[#c3c5d9] px-1.5 py-1">
          <option value="planned">Planned</option>
          <option value="done">Done</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button disabled={!title.trim() || saving} onClick={submit}
          className="rounded-lg bg-[#0041c8] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {saving ? 'Saving…' : 'Add'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-[#c3c5d9] px-3 py-1.5 text-xs">Cancel</button>
      </div>
    </div>
  );

  async function submit() {
    setSaving(true);
    try {
      await onSave({ title: title.trim(), date, end_date: endDate || null, status, category_id: categoryId || null, date_precision: 'exact' });
    } finally { setSaving(false); }
  }
}

// Prompt 385 §B.3 — the DetailPopover that used to live here (view AND
// inline edit) is gone: RoadmapEventDetailPanel.tsx is its replacement,
// rendered by the caller (RoadmapPanel/DossierOverviewSections) beside
// Categories, below the canvas — selection is lifted (see selectedId/
// onSelect above) precisely so that panel can live outside this component's
// own DOM subtree.

function ClusterListPopover({ events, onClose, onSelect }: { events: CanvasEvent[]; onClose: () => void; onSelect: (ev: CanvasEvent) => void }) {
  return (
    <div className="mt-3 rounded-lg border border-[#c3c5d9]/40 bg-white/90 backdrop-blur-md p-2 shadow-md">
      <ul className="space-y-1">
        {events.map((ev) => (
          <li key={ev.id}>
            <button onClick={() => onSelect(ev)} className="w-full rounded px-2 py-1 text-left text-xs text-[#131b2e] hover:bg-[#eaedff]">
              {ev.title} <span className="text-[#434656]/60">— {ev.date}</span>
            </button>
          </li>
        ))}
      </ul>
      <button onClick={onClose} className="mt-1 text-xs text-[#434656]/60 hover:underline">Close</button>
    </div>
  );
}
