// Prompt 531 — migration-gate probe for the moderation lifecycle tables
// (migration 0291, applied in production 2026-09-02), same pattern as every
// other migration-gated feature in this codebase. The probe stays: it is
// what keeps a preview branch or a not-yet-migrated environment reporting
// the new surfaces as unavailable rather than throwing.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const networkModerationAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('network_strikes').select('id').limit(1);
  return !error;
});
