// Prompt 277 A.3 — migration 0196 (entity_fraud_flags). Gates the founder-
// facing "Report — suspected fraud/scam" route and the backoffice review
// queue, same capability-probe convention as suspicious-flags-capability.ts.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const entityFraudFlagsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('entity_fraud_flags').select('id').limit(1);
  return !error;
});
