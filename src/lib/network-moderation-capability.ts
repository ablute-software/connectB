// Prompt 531 — migration-gate probe for the moderation lifecycle tables
// (migration 0291), same pattern as every other migration-gated feature in
// this codebase. Until 0291 is applied, the back-office keeps the strike
// action it already had and the new surfaces report themselves as not yet
// available rather than throwing.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const networkModerationAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('network_strikes').select('id').limit(1);
  return !error;
});
