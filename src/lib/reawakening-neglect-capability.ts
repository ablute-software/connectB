// Prompt 271 §3 — capability probe for migration 0192's reawakening_proposals
// .trigger_kind column (the third, 'neglect' origin). The table itself is
// already gated by reawakeningAvailable (migration 0030) — this probes the
// NEW column specifically, since a server instance could have the table
// without yet having this column applied. Negatives re-probe after a short
// TTL, same as every other capability probe.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const reawakeningNeglectAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('reawakening_proposals').select('trigger_kind').limit(1);
  return !error;
});
