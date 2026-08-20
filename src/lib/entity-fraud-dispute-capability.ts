// Prompt 285 §2 — migration 0199 (entity_fraud_flags.dispute_reason/
// disputed_at/disputed_by), separate from entityFraudFlagsAvailable
// (0196, the table itself) since these are three additive columns that
// can land after the table already exists — the dispute route must not
// write to them until the migration is actually applied.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const entityFraudDisputeAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('entity_fraud_flags').select('dispute_reason').limit(1);
  return !error;
});
