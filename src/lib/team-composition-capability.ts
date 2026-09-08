import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

// Prompt 613 §E — migration 0342 (company_role_coverage, and the commitment
// column beside it). The card degrades to "not available yet" rather than
// erroring on an environment that has not applied it.
export const teamRoleCoverageAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('company_role_coverage').select('id').limit(1);
  return !error;
});
