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
