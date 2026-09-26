// Copied as-is from origin/claude/prompt-585-people-evidence-hooks (never
// merged), approved for reuse in Prompt 737 Fase 0B (25/09/2026) — the
// rest of that branch's app code was reviewed file-by-file and is not
// used here (most of it is hook-suggestion code, deferred to Fase 4; see
// DECISIONS.md, Prompt 737).
// Prompt 585 §D — a numeric seniority_rank (1-9, from
// catalog_seniority_rank_from_title() in migration 0331) has never had a
// display label anywhere in the app; confirmed by research before writing
// this. Mirrors that SQL function's own rank meanings so the two never
// drift into disagreement.
export function seniorityRankLabel(rank: number | null | undefined): string | null {
  switch (rank) {
    case 1: return 'Founding / Managing / General Partner';
    case 2: return 'Partner';
    case 3: return 'Venture Partner / Associate';
    case 4: return 'Analyst';
    case 9: return 'Other role';
    default: return null;
  }
}
