// Item #15 — propose-only migration 0139 (orgs.is_test, catalog_entities.is_test).
// Same pattern as every other migration-gated feature: filtering lights up
// the moment Nuno applies the migration, no deploy needed.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const pipelineTestFlagAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('is_test').limit(1);
  return !error;
});
