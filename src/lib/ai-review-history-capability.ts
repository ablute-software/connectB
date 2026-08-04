// Prompt 117 Bloco B — History tab. Propose-only migration (0112,
// ai_reviews.input_text/title/created_by/source/input_meta); this probe
// gates both the write side (route.ts only sends those keys once they
// exist) and the read side (HistoryPanel falls back to
// coalesce(input_text, interaction_draft) and an honest "not recorded"
// label when the migration hasn't landed) — same pattern as every other
// migration-gated feature (capability-probe.ts).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const aiReviewHistoryFieldsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('ai_reviews').select('input_text').limit(1);
  return !error;
});
