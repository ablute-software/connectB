// Prompt 167 — pure roadmap logic, shared by the founder-editable
// RoadmapCard and the investor-facing read-only reuse of the same
// RoadmapTimeline component. No I/O, unit-tested independently of the UI.
export type RoadmapPeriodKind = 'quarter' | 'year';

export interface RoadmapPeriod {
  period_kind: RoadmapPeriodKind;
  period_year: number;
  period_quarter?: number;
}

// Nuno's own decision (§ Decisões) — a whole-year milestone reads as that
// year's headline goal, so it sorts BEFORE that same year's quarters, not
// after. 0 for 'year', the literal quarter number otherwise.
export function quarterSortKey(kind: RoadmapPeriodKind, quarter?: number): number {
  return kind === 'year' ? 0 : (quarter ?? 0);
}

export function sortRoadmapPeriods<T extends RoadmapPeriod>(periods: T[]): T[] {
  return [...periods].sort((a, b) => (
    a.period_year - b.period_year
    || quarterSortKey(a.period_kind, a.period_quarter) - quarterSortKey(b.period_kind, b.period_quarter)
  ));
}

export function periodLabel(kind: RoadmapPeriodKind, year: number, quarter?: number): string {
  return kind === 'year' ? String(year) : `Q${quarter} ${year}`;
}

// A quarter has passed once its LAST day is behind `now`; a year, once
// Dec 31 is. UTC throughout so this doesn't depend on the server/browser's
// local timezone for a "did this period end yet" call that only needs
// day-level precision.
export function periodHasPassed(period: RoadmapPeriod, now: Date): boolean {
  const endMonth = period.period_kind === 'year' ? 11 : (period.period_quarter! * 3 - 1);
  const end = new Date(Date.UTC(period.period_year, endMonth + 1, 0, 23, 59, 59));
  return end.getTime() < now.getTime();
}

export function periodKey(period: RoadmapPeriod): string {
  return `${period.period_kind}:${period.period_year}:${period.period_quarter ?? ''}`;
}
