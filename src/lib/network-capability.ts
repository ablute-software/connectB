// Prompt 316 — migration-gate probe, same pattern as every other
// migration-gated feature (capability-probe.ts).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const networkAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('network_actors').select('id').limit(1);
  return !error;
});
