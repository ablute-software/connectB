// Company tab redesign — capability probe for migration 0037. Checks
// company_people (the one genuinely new table; the new orgs.* columns land
// in the same migration, so this one probe gates the whole feature) — same
// pattern as company-canon.ts.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const companyProfileAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('company_people').select('id').limit(1);
  return !error;
});
