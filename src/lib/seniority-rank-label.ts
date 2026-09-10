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
