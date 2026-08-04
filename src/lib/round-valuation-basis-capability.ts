// Prompt 115 Block E — pre/post-money valuation. Propose-only migration
// (0111, orgs.round_valuation_basis); this probe is what lets the UI light
// up the basis toggle and start persisting it the moment Nuno applies the
// migration, with no code deploy needed — same pattern as every other
// migration-gated feature (capability-probe.ts, e.g. company-profile-capability.ts).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const roundValuationBasisAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('round_valuation_basis').limit(1);
  return !error;
});
