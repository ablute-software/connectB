// P136 — propose-only migration 0131 (investor_interest_levels). Same
// pattern as every other migration-gated feature: lets the disclosure
// ladder light up the moment Nuno applies the migration, no deploy needed.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const interestLevelAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('investor_interest_levels').select('id').limit(1);
  return !error;
});
