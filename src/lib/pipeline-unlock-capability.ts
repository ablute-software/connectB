// Prompt 123 Block B.2 — propose-only migration 0120 (orgs.profile_completed_at,
// orgs.plan_started_at). This probe lets /api/pipeline-unlock degrade
// gracefully (months-since-unlock = 0, no monthly growth) until Nuno applies
// the migration — same pattern as every other migration-gated feature.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const pipelineUnlockAnchorsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('profile_completed_at, plan_started_at').limit(1);
  return !error;
});
