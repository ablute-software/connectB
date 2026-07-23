// Needs-review redesign — capability probe for migration 0021
// (interactions.classified_by, entities.notes). Negatives re-probe after a
// short TTL (see capability-probe.ts) — the founder's live session showed
// this feature "not available" long after migration 0021 was applied,
// because the old probe cached a negative forever.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const needsReviewAiAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('interactions').select('classified_by').limit(1);
  return !error;
});
