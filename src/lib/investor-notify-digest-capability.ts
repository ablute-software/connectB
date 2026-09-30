import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

// Prompt 747 §B — gates the daily notify-digest sweep on
// matchdeal_investor_members.notify_new_eligible_last_sent_at (this
// prompt's own migration) existing yet. Same contract as every other job in
// /api/automations/route.ts: degrade to a silent no-op on an environment
// where the migration hasn't been applied, never throw. Per this codebase's
// migration discipline (CLAUDE.md), that migration is a FILE only until
// Nuno gives an explicit "yes" to apply it — this probe is what keeps the
// cron safe to deploy before that happens.
export const investorNotifyDigestAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('matchdeal_investor_members').select('notify_new_eligible_last_sent_at').limit(1);
  return !error;
});
