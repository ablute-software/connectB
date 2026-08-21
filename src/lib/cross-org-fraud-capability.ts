// Prompt 285 §3 — migration 0200 (entities.hard_filter_block_source).
// Gates both the cross-org threshold write path and the banner's read of
// that column, same makeCapabilityProbe pattern as every other additive
// migration this session.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const crossOrgFraudBlockSourceAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('entities').select('hard_filter_block_source').limit(1);
  return !error;
});
