// Batch 3 A — capability probe for migration 0025's review_runs table.
// Gates the investability-ranking "Run review" UI on the Review &
// Optimization page. Negatives re-probe after a short TTL (capability-probe.ts).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const reviewRunsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('review_runs').select('id').limit(1);
  return !error;
});
