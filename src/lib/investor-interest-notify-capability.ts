// Prompt 126 E — propose-only migration 0124 (investor_relationship_
// decisions.seen_at + matchdeal_record_interest_notification()). Gates
// both the API route's best-effort call to that function and the founder
// popup's own poll route.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const investorInterestNotifyAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('investor_relationship_decisions').select('seen_at').limit(1);
  return !error;
});
