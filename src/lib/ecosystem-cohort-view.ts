// Prompt 707 — presentation helpers shared by the Ecosystem X-Ray tab
// (EcosystemTab.tsx), its CSV export (api/backoffice/metrics/ecosystem's
// own route, format=csv), and its printable PDF report
// (app/metrics/ecosystem-report). Moved out of EcosystemTab.tsx so the
// segment/period labels and category/severity vocabulary can't drift
// between what's on screen and what ends up in an exported file — the
// export's whole point is "the same thing the screen shows," not a
// second description of it.
export const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'pre_seed', label: 'Pre-seed' }, { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' }, { value: 'series_b', label: 'Series B' },
  { value: 'series_c_plus', label: 'Series C+' }, { value: 'later', label: 'Later' },
  { value: 'other', label: 'Other' },
];
export const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All time' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' },
];
export const SEVERITY_ORDER = ['low', 'medium', 'high'];
export const SEVERITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const CATEGORY_LABEL: Record<string, string> = {
  product: 'Product', traction: 'Traction', team: 'Team', positioning: 'Positioning', financing: 'Financing',
  regulatory: 'Regulatory', market: 'Market', metrics: 'Metrics', other: 'Other',
};

export function heatCellColor(pct: number): string {
  // Sequential, one hue — a prevalence %, not a categorical distinction.
  if (pct >= 60) return 'bg-[#7C1D1D] text-white';
  if (pct >= 40) return 'bg-[#B00000] text-white';
  if (pct >= 20) return 'bg-red-200 text-red-900';
  return 'bg-red-50 text-red-700';
}

export interface CohortFilters { country?: string; sector?: string; stage?: string; sinceDays?: string }

export function segmentLabel(filters: CohortFilters): string {
  const parts = [
    filters.country?.trim() || undefined,
    filters.sector || undefined,
    filters.stage ? (STAGE_OPTIONS.find((s) => s.value === filters.stage)?.label ?? filters.stage) : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'All startups';
}

export function periodLabel(sinceDays?: string): string {
  return PERIOD_OPTIONS.find((p) => p.value === (sinceDays ?? ''))?.label ?? 'All time';
}

// Filesystem/URL-safe slug for a report's downloaded filename — cosmetic
// only, never used for anything security- or anonymity-relevant.
export function filenameSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'all-startups';
}

export const ECOSYSTEM_CSV_COLUMNS = ['field', 'category', 'severity', 'value'];

export interface EcosystemCohortAggregates {
  cohortN: number;
  sri: { score: number } | null;
  heatmap: { category: string; severity: string; pctOfCohort: number }[];
}

// Pure row-builder for the CSV export — the exact same aggregates the
// screen renders (cohort n, SRI score, heatmap cells), never a raw org
// row. Kept separate from the API route so it's unit-testable without a
// SupabaseClient, and so "what the CSV contains" can be verified against
// "what the screen shows" as a single, direct assertion.
export function buildEcosystemCsvRows(filters: CohortFilters, aggregates: EcosystemCohortAggregates): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [
    { field: 'Note', category: '', severity: '', value: 'Internal sample — not representative of the full market' },
    { field: 'Segment', category: '', severity: '', value: segmentLabel(filters) },
    { field: 'Period', category: '', severity: '', value: periodLabel(filters.sinceDays) },
    { field: 'Cohort size (n)', category: '', severity: '', value: aggregates.cohortN },
    { field: 'SRI v0', category: '', severity: '', value: aggregates.sri?.score ?? '' },
  ];
  for (const cell of aggregates.heatmap) {
    rows.push({
      field: 'Weakness map', category: CATEGORY_LABEL[cell.category] ?? cell.category,
      severity: SEVERITY_LABEL[cell.severity] ?? cell.severity, value: `${cell.pctOfCohort}%`,
    });
  }
  return rows;
}
