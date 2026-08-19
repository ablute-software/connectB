// Prompt 272 — capability probe for migration 0193's reawakening_proposals
// .advice column (the structured adviser breakdown). Separate from
// reawakeningNeglectAvailable (0192's trigger_kind) since a server
// instance could have trigger_kind without yet having advice applied.
// Negatives re-probe after a short TTL, same as every other probe.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const reawakeningAdviceAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('reawakening_proposals').select('advice').limit(1);
  return !error;
});
