// Prompt 727 §6 — same makeCapabilityProbe idiom every other migration-gated
// feature in this codebase already uses (document-extraction-capability.ts,
// reevaluation-capability.ts, …): a probe against the real schema, cached
// positive forever, re-checked after a short TTL when negative. The
// product_events table this checks is PROPOSED, not applied (see
// supabase/migrations/20260923..._product_events.sql) — until it's applied,
// this probe returns false and /api/product-events no-ops on every call.
import { makeCapabilityProbe } from './capability-probe';

export const productEventsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('product_events').select('id').limit(1);
  return !error;
});
