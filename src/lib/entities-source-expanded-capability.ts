// Prompt 124 C4 — propose-only migration 0122 expands entities.source's
// check constraint (catalog/manual/match_deal -> +bulk_import/known_contact/
// investor_invite). A plain column-select probe can't see constraint
// values, so this calls the migration's own entities_source_expanded()
// SQL helper, which introspects the live constraint definition directly —
// read-only, no insert/rollback needed.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const entitiesSourceExpandedAvailable = makeCapabilityProbe(async (admin) => {
  const { data, error } = await admin.rpc('entities_source_expanded');
  return !error && data === true;
});
