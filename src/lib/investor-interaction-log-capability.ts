// P133 (item 10) — propose-only migration (0125, investor_interaction_log).
// Same pattern as every other migration-gated feature (capability-probe.ts):
// lets the Interaction log light up the moment Nuno applies the migration,
// with no code deploy needed.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const interactionLogAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('investor_interaction_log').select('id').limit(1);
  return !error;
});
