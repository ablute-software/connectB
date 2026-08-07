// "Claim this profile" capability probe — migration 0145 (PROPOSED, NOT
// APPLIED). Negatives re-probe after a short TTL (see capability-probe.ts)
// so applying the migration is picked up within ~60s. Gates: the
// /investors landing "Claim this profile" CTA, POST/GET /api/portal/claims,
// and the backoffice claims queue.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const investorEntityClaimsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('investor_entity_claims').select('id').limit(1);
  return !error;
});

export const matchdealMemberRoleAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('matchdeal_investor_members').select('role').limit(1);
  return !error;
});
