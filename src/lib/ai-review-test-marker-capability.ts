// Verification follow-up (V4) — propose-only migration (0113,
// ai_reviews.is_test). Once applied, this lets the History tab filter out
// verification-script rows for good; not wired into HistoryPanel yet since
// it also depends on migration 0112 (input_text/title) already landing —
// no point filtering a column that doesn't exist. Same capability-probe
// pattern as every other migration-gated feature (capability-probe.ts).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const aiReviewIsTestMarkerAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('ai_reviews').select('is_test').limit(1);
  return !error;
});
