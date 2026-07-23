// IRM_SPEC §11 — Company Canon capability probe. Overnight-block rule: main
// must be indistinguishable from today until migration 0020 is applied, so
// every canon-dependent code path (Company nav link, composer provenance
// gate, alignment checks) asks this first rather than assuming the table
// exists. Negatives re-probe after a short TTL so a just-applied migration
// is picked up (see capability-probe.ts).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const companyCanonAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('company_facts').select('id').limit(1);
  return !error;
});
