// Prompt 359 Block B/C — pure geometry/density functions for the roadmap
// canvas. No I/O, no DOM — the canvas component measures its own container
// width and calls these; unit-tested independently, same discipline as
// roadmap.ts/roadmap-fit.ts before it.

// ---------------------------------------------------------------------------
// Date <-> X position. A linear scale over [domainStart, domainEnd] mapped
// to [0, width]. Both directions share the same span math on purpose — a
// drift between xFromDate and dateFromX would make "click here, land there"
// silently wrong.
export function xFromDate(date: Date, domainStart: Date, domainEnd: Date, width: number): number {
  const span = domainEnd.getTime() - domainStart.getTime();
  if (span <= 0) return 0;
  return ((date.getTime() - domainStart.getTime()) / span) * width;
}

export function dateFromX(x: number, domainStart: Date, domainEnd: Date, width: number): Date {
  const span = domainEnd.getTime() - domainStart.getTime();
  if (width <= 0) return new Date(domainStart);
  const ms = domainStart.getTime() + (x / width) * span;
  return new Date(ms);
}

// Prompt 359 §B.1 — "snap ao mês; editável": a click lands on the 1st of
// whichever month it fell in, in UTC (day-level precision only, same
// reasoning as roadmap.ts's periodHasPassed — never depends on the
// browser's local timezone for a date-only concept).
export function snapToMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// ---------------------------------------------------------------------------
// Density — "a vista base mostra TUDO, sempre... tipografia e símbolos
// ENCOLHEM": the level is a function of how much horizontal room each event
// actually has (container width / event count on that lane), never the
// count alone — the same 6 events read as spacious in a wide panel and
// cramped in a narrow one.
export type DensityLevel = 'label' | 'short' | 'symbol' | 'cluster';

const LABEL_MIN_SPACING_PX = 160;
const SHORT_MIN_SPACING_PX = 90;
const SYMBOL_MIN_SPACING_PX = 40;

export function densityLevel(avgSpacingPx: number): DensityLevel {
  if (avgSpacingPx >= LABEL_MIN_SPACING_PX) return 'label';
  if (avgSpacingPx >= SHORT_MIN_SPACING_PX) return 'short';
  if (avgSpacingPx >= SYMBOL_MIN_SPACING_PX) return 'symbol';
  return 'cluster';
}

export function densityLevelForLane(containerWidthPx: number, eventCount: number): DensityLevel {
  if (eventCount <= 1) return 'label';
  return densityLevel(containerWidthPx / eventCount);
}

// ---------------------------------------------------------------------------
// Clustering — events that land within MIN_EVENT_GAP_PX of each other on
// the same lane collapse into one numbered chip (⬤3), same idea as
// densityLevel but operating on actual pixel positions rather than an
// average — two events can be far from the lane's average spacing and still
// need to merge if THEY happen to be close together (a burst of activity in
// one month, sparse everywhere else).
export const MIN_EVENT_GAP_PX = 28;

export interface PositionedItem<T> { item: T; x: number }
export interface Cluster<T> { items: T[]; x: number }

export function clusterByProximity<T>(positioned: PositionedItem<T>[], minGapPx: number = MIN_EVENT_GAP_PX): Cluster<T>[] {
  const sorted = [...positioned].sort((a, b) => a.x - b.x);
  const clusters: Cluster<T>[] = [];
  // Chaining must compare against the LAST item actually placed in the
  // cluster, never the cluster's running average — an average creeps toward
  // the center as members join, which can put it MORE than minGapPx from
  // the next item even though that item is transitively close to its
  // immediate neighbor (a -> b -> c, each step small, average drifts).
  let lastX = -Infinity;
  for (const p of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && p.x - lastX < minGapPx) {
      current.x = (current.x * current.items.length + p.x) / (current.items.length + 1);
      current.items.push(p.item);
    } else {
      clusters.push({ items: [p.item], x: p.x });
    }
    lastX = p.x;
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Zoom levels — "tudo -> ano -> trimestre". Each level narrows the visible
// date window; 'all' always equals the full domain (what "Fit" resets to).
export type ZoomLevel = 'all' | 'year' | 'quarter';

export function zoomWindow(level: ZoomLevel, focus: Date, domainStart: Date, domainEnd: Date): { start: Date; end: Date } {
  if (level === 'all') return { start: domainStart, end: domainEnd };
  const months = level === 'year' ? 12 : 3;
  const half = months / 2;
  const start = new Date(Date.UTC(focus.getUTCFullYear(), focus.getUTCMonth() - Math.floor(half), 1));
  const end = new Date(Date.UTC(focus.getUTCFullYear(), focus.getUTCMonth() + Math.ceil(half), 1));
  // Never a window wider than the actual domain, and never outside it —
  // zooming "in" near either edge clamps rather than showing empty space.
  const clampedStart = start.getTime() < domainStart.getTime() ? domainStart : start;
  const clampedEnd = end.getTime() > domainEnd.getTime() ? domainEnd : end;
  return { start: clampedStart, end: clampedEnd };
}

// ---------------------------------------------------------------------------
// Past/Future/Both filter (§C.3).
export type TimeToggle = 'past' | 'future' | 'both';

export function matchesTimeToggle(status: 'done' | 'planned', toggle: TimeToggle): boolean {
  if (toggle === 'both') return true;
  return toggle === 'past' ? status === 'done' : status === 'planned';
}

// ---------------------------------------------------------------------------
// Prompt 382 §D — the persistent per-category on/off switch. A second cut
// on the SAME `filtered` list matchesTimeToggle already produces (not a
// second pass) — one more condition, same as timeToggle sits alongside it.
// `lanesUsed` and `domain` both derive from `filtered`, so an off category's
// lane disappears from the canvas and stops occupying domain width, for
// free, by construction — same "des-zooma ao desaparecer" precedent already
// written for the old milestone-based filter in roadmap-categories.ts.
//
// General (category_id null, or an id that no longer resolves to a saved
// category) is never a saved row — roadmap-categories.ts's own words: "não
// é uma categoria gravada — é a ausência de uma" — so it is never subject
// to this cut, with no exception and no phantom `visible` flag invented for
// it.
export function matchesCategoryVisibility(
  categoryId: string | null | undefined,
  categories: { id: string; visible?: boolean }[],
): boolean {
  if (!categoryId) return true;
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return true;
  return category.visible !== false;
}

// ---------------------------------------------------------------------------
// Prompt 385 §B.2 — the three-state model the detail panel shows (COMPLETED/
// PLANNED/IN PROGRESS), derived from the two real states the DB stores
// ('done'/'planned') plus whether "now" falls inside the event's own period —
// never a third stored value. A point event (no end_date) is only ever
// completed or planned; IN PROGRESS only exists for a period with an end
// date that "now" is currently inside.
export type EventState = 'completed' | 'planned' | 'in_progress';

export function derivedEventState(
  status: 'done' | 'planned', date: string, endDate: string | null | undefined, now: Date,
): EventState {
  if (status === 'done') return 'completed';
  if (endDate) {
    const start = new Date(date).getTime();
    const end = new Date(endDate).getTime();
    const t = now.getTime();
    if (t >= start && t <= end) return 'in_progress';
  }
  return 'planned';
}

// Prompt 385 §A.4 — the quarter header label format from the mockup
// ("Q1 '24"), derived from a plain ISO date — never a separate stored field.
export function quarterLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `Q${q} '${yy}`;
}

// Prompt 385 §A.4 — the quarter header row: every calendar quarter the
// [start, end] view window touches, in order, each with its own [start, end]
// boundary dates so the caller can position it with the same xFromDate scale
// the rest of the canvas already uses. Pure/testable on purpose, same
// discipline as everything else in this file — the component only turns
// these into pixels and JSX.
export interface QuarterSpan { start: Date; end: Date; label: string }

// Prompt 387 §A — the shared walker behind quartersInRange/semestersInRange/
// yearsInRange: every calendar span of `monthsPerSpan` months the window
// touches, in order. Extracted once three near-identical loops would
// otherwise exist (quarter=3 months, semester=6, year=12) — same discipline
// as densityLevel/densityLevelForLane sharing one threshold table above.
function spansInRange(start: Date, end: Date, monthsPerSpan: number, label: (spanStart: Date) => string): QuarterSpan[] {
  if (end.getTime() <= start.getTime()) return [];
  const spans: QuarterSpan[] = [];
  let y = start.getUTCFullYear();
  let m = Math.floor(start.getUTCMonth() / monthsPerSpan) * monthsPerSpan;
  while (true) {
    const spanStart = new Date(Date.UTC(y, m, 1));
    const spanEnd = new Date(Date.UTC(y, m + monthsPerSpan, 1));
    if (spanStart.getTime() >= end.getTime()) break;
    spans.push({ start: spanStart, end: spanEnd, label: label(spanStart) });
    m += monthsPerSpan;
    if (m >= 12) { m -= 12; y += 1; }
  }
  return spans;
}

export function quartersInRange(start: Date, end: Date): QuarterSpan[] {
  return spansInRange(start, end, 3, (s) => quarterLabel(s.toISOString()));
}

// Prompt 387 §A — "S1 '24" / "S2 '24", the semester twin of quarterLabel.
export function semesterLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const s = d.getUTCMonth() < 6 ? 1 : 2;
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `S${s} '${yy}`;
}
export function semestersInRange(start: Date, end: Date): QuarterSpan[] {
  return spansInRange(start, end, 6, (s) => semesterLabel(s.toISOString()));
}

// Prompt 387 §A — the full year, e.g. "2024" — no apostrophe-shorthand at
// this granularity, it's the one already used on the mockup/Founded node.
export function yearLabel(dateStr: string): string {
  return String(new Date(dateStr).getUTCFullYear());
}
export function yearsInRange(start: Date, end: Date): QuarterSpan[] {
  return spansInRange(start, end, 12, (s) => yearLabel(s.toISOString()));
}

// Prompt 387 §A — "quando a linha do tempo for muito grande para caber...
// em vez de Quarter teremos Semestre, ou apenas mesmo só o ano" (Nuno's own
// words). Derived from how many pixels the CURRENT zoom actually gives each
// quarter-width slice — not from the total domain — so "+" (zooming in)
// genuinely earns quarters back the moment there's room, exactly the "até
// que se aplique '+'" he asked for. Thresholds picked so a label never has
// to squeeze below ~4 characters' worth of width; tuned against the real
// ablute_ roadmap (2019→2027, ~33 quarters) during verification.
export type HeaderGranularity = 'quarter' | 'semester' | 'year';
const QUARTER_MIN_PX = 56;
const SEMESTER_MIN_PX = 28;
export function headerGranularity(pxPerQuarter: number): HeaderGranularity {
  if (pxPerQuarter >= QUARTER_MIN_PX) return 'quarter';
  if (pxPerQuarter >= SEMESTER_MIN_PX) return 'semester';
  return 'year';
}

// ---------------------------------------------------------------------------
// Prompt 359 Block A — pure half of the data migration (0237's own SQL does
// the real one-time backfill; this is the equivalent logic exposed as a
// testable function so "migração sem perder nada" has a unit test, not only
// a manual SQL check). Mirrors 0237's date-approximation exactly: a period's
// FIRST day, precision recorded as 'approx' (year) or 'quarter'.
export interface LegacyMilestone {
  period_kind: 'quarter' | 'year';
  period_year: number;
  period_quarter?: number | null;
  items_v2?: { text: string; category_id: string | null }[] | null;
  items: string[];
}
export interface MigratedEventInput {
  title: string;
  date: string; // YYYY-MM-DD
  date_precision: 'approx' | 'quarter';
  category_id: string | null;
}

function isoDate(year: number, month1to12: number): string {
  return `${year}-${String(month1to12).padStart(2, '0')}-01`;
}

export function migrateMilestoneToEvents(m: LegacyMilestone): MigratedEventInput[] {
  const items = (m.items_v2 && m.items_v2.length > 0) ? m.items_v2 : m.items.map((text) => ({ text, category_id: null }));
  const date = m.period_kind === 'year' ? isoDate(m.period_year, 1) : isoDate(m.period_year, (m.period_quarter! - 1) * 3 + 1);
  const date_precision: 'approx' | 'quarter' = m.period_kind === 'year' ? 'approx' : 'quarter';
  return items
    .filter((i) => i.text?.trim())
    .map((i) => ({ title: i.text.trim(), date, date_precision, category_id: i.category_id }));
}
