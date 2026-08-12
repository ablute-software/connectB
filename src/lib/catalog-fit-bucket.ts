// Prompt 139 D3 — maps catalog_top_matches' raw 0-100 score to the fit_score
// bucket a delivered entity row gets written with. Thresholds per the
// prompt: high >=75, medium_high >=55, medium >=35, else low.
//
// Extracted out of store-supabase.tsx (Prompt 179 §B) so the monthly catalog
// delivery cron job (server-side, /api/automations) can build entity rows
// using the EXACT same bucketing unlockPack() already uses client-side,
// rather than a second, driftable copy.
import type { FitScore } from './types';

export function fitBucketFromScore(score: number): FitScore {
  if (score >= 75) return 'high';
  if (score >= 55) return 'medium_high';
  if (score >= 35) return 'medium';
  return 'low';
}
