// Prompt 122 Block B (F1) capability probe — migration 0116 (PROPOSED, NOT
// APPLIED). Same pattern as every other probe in capability-probe.ts:
// negatives re-probe after a short TTL so applying the migration is picked
// up within ~60s. Gates every instrumentation call site (ai_reviews insert,
// decide_investor_relationship caller, access_grants creation) AND the
// Ecosystem tab's real content (Prompt 122 Block C) — with the migration
// unapplied, everything behaves exactly as it does today.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const ecosystemFactsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('ecosystem_facts').select('id').limit(1);
  return !error;
});
