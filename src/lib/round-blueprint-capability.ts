import 'server-only';
// Prompt 534 Phase 1 — migration 0294 gate. Same probe pattern every other
// migration-gated feature uses: the tab degrades to "not available yet" until
// round_blueprint_scenarios exists, rather than throwing at the founder.
import { makeCapabilityProbe } from './capability-probe';

export const roundBlueprintAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('round_blueprint_scenarios').select('id').limit(1);
  return !error;
});
