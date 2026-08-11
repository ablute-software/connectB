// Prompt 168 — shared types/helpers for review_clarifications (migration
// 0160), used by every surface that renders a Review bullet (ReviewPanel,
// SwotVisualCard, HistoryPanel, the standalone report page) plus Settings'
// "Company facts & Clarifications" and the investor-facing projection.
export type ReviewCategory = 'strengths' | 'weaknesses' | 'opportunities' | 'threats' | 'risks' | 'recommendations';

export const REVIEW_CATEGORIES: ReviewCategory[] = ['strengths', 'weaknesses', 'opportunities', 'threats', 'risks', 'recommendations'];

export interface ReviewClarification {
  id: string;
  org_id: string;
  review_run_id: string;
  category: ReviewCategory;
  item_index: number;
  item_text: string;
  clarification_text: string;
  visible_to_investors: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// One clarification per (run, category, position) — matches the table's own
// unique constraint, so this key is exactly "does this bullet have one yet".
export function clarificationKey(reviewRunId: string, category: ReviewCategory, itemIndex: number): string {
  return `${reviewRunId}:${category}:${itemIndex}`;
}

export function clarificationsByKey(rows: ReviewClarification[]): Map<string, ReviewClarification> {
  const map = new Map<string, ReviewClarification>();
  for (const r of rows) map.set(clarificationKey(r.review_run_id, r.category, r.item_index), r);
  return map;
}

// Local-state helper for the optimistic update after a save: replaces an
// existing row by id, or prepends a brand-new one.
export function upsertClarification(rows: ReviewClarification[], next: ReviewClarification): ReviewClarification[] {
  const idx = rows.findIndex((r) => r.id === next.id);
  if (idx === -1) return [next, ...rows];
  const copy = rows.slice();
  copy[idx] = next;
  return copy;
}
