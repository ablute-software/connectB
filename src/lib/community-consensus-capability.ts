// Prompt 266 capability probe for migration 0189 (catalog_field_consensus
// and its 3 companion tables), PROPOSED, not yet applied. Same shape as
// every other migration-gated feature in this codebase.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const communityConsensusAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('catalog_field_consensus').select('id').limit(1);
  return !error;
});
