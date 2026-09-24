// Prompt 729 §3.2 — same propose-only-migration pattern as
// round-valuation-basis-capability.ts. The migration
// (supabase/migrations/<timestamp>_report_input_snapshots.sql) adds
// review_runs.input_snapshot (and the same column on ai_reviews/
// coaching_runs, for when those are wired) — this probe is what lets
// /api/review/investability start writing the column the moment the
// migration is applied, with no code deploy needed.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const reviewRunSnapshotAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('review_runs').select('input_snapshot').limit(1);
  return !error;
});
