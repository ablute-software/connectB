// Prompt 124 C1 — propose-only migration 0122 (orgs.acquisition_source,
// orgs.acquisition_source_detail). Gates the signup-time write so
// provision-org degrades gracefully (skips the field) pre-migration.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const acquisitionSourceAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('acquisition_source').limit(1);
  return !error;
});
