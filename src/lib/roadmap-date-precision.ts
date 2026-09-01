// Prompt 519 §4(d) — RoadmapDatePrecision ('exact' | 'approx' | 'quarter')
// has existed in types.ts and been accepted by storage since the roadmap was
// built, but nothing could ever produce anything but 'exact': CreatePopover's
// only date control was <input type="date"> and its submit() hardcoded
// date_precision: 'exact', while the edit form did not send the field at all.
// So a founder who genuinely only knows "some time in Q3" had to invent a day.
//
// The stored value stays a real ISO date either way — everything downstream
// (the x-axis, sorting, the domain calculation) does date arithmetic on it and
// must not learn about precision. Precision is a statement about how much of
// that date to BELIEVE, not a different storage format. These helpers are the
// one place that mapping lives, so the create form, the edit form and any
// future importer cannot disagree about which day "Q3 2026" means.
import type { RoadmapDatePrecision } from './types';

export type { RoadmapDatePrecision };

/** Anchor day for each precision: the first day of the period named. */
export function dateFromParts(
  precision: RoadmapDatePrecision,
  parts: { year: number; month?: number; quarter?: number; exact?: string },
): string {
  if (precision === 'exact') return parts.exact ?? `${pad4(parts.year)}-01-01`;
  if (precision === 'quarter') {
    const q = clamp(parts.quarter ?? 1, 1, 4);
    return `${pad4(parts.year)}-${pad2((q - 1) * 3 + 1)}-01`;
  }
  // 'approx' — month + year, anchored to the 1st.
  return `${pad4(parts.year)}-${pad2(clamp(parts.month ?? 1, 1, 12))}-01`;
}

/** Read an existing ISO date back into the parts a precision editor needs. */
export function partsFromDate(date: string): { year: number; month: number; quarter: number } {
  const [y, m] = date.split('-');
  const year = Number(y) || new Date().getUTCFullYear();
  const month = clamp(Number(m) || 1, 1, 12);
  return { year, month, quarter: Math.floor((month - 1) / 3) + 1 };
}

/** How a date should READ once precision is taken into account. */
export function formatWithPrecision(date: string, precision: RoadmapDatePrecision | null | undefined): string {
  const { year, month, quarter } = partsFromDate(date);
  if (precision === 'quarter') return `Q${quarter} ${year}`;
  if (precision === 'approx') return `${MONTHS[month - 1]} ${year}`;
  return date;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }
function pad2(n: number) { return String(n).padStart(2, '0'); }
function pad4(n: number) { return String(n).padStart(4, '0'); }
