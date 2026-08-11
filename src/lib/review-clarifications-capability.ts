// Prompt 168 — capability probe for migration 0160's review_clarifications
// table. Gates the clarification bubble UI everywhere it appears until the
// migration is confirmed applied — same pattern as reviewRunsAvailable
// (review-capability.ts) for review_runs itself.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const reviewClarificationsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('review_clarifications').select('id').limit(1);
  return !error;
});
