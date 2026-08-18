// Prompt 123 Block C.2 — migration 0121 (orgs/catalog_entities
// moderation_status, account_moderation_actions, is_account_suspended()),
// applied in production. Kept as a capability probe anyway (same
// convention as every other migration-gated feature) so a fresh
// environment that hasn't run migrations yet degrades instead of erroring.
// Gates the Backoffice suspend/delete UI and the middleware login check.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const accountModerationAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('moderation_status').limit(1);
  return !error;
});
