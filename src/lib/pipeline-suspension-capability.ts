import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

// Prompt 184 §2 — gates orgs.owner_suspended_at/platform_suspended_at/
// suspension_reminded_at (migration 0168), so eligiblePipelineOrgIds() and
// /api/company/visibility degrade gracefully (fall back to the
// matchdeal_profiles-only suspension check that already existed) on an
// environment where the migration hasn't landed yet, instead of erroring.
export const orgsPipelineSuspensionAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('owner_suspended_at, platform_suspended_at, suspension_reminded_at').limit(1);
  return !error;
});
