// Plans & Account batch — capability probe for migration 0028. The presence of
// the orgs.plan_change_requested column signals that 0028 has landed, i.e. the
// plan column is now text (accepts the three new tiers) AND the request queue
// exists. Gates the upgrade-request flow and back-office set-plan controls;
// display + AI gating work without it (they only read/map the plan value).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const planAccountsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('plan_change_requested').limit(1);
  return !error;
});
