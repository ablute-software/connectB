// Batch 3 C — capability probe for migration 0026's orgs.permission_matrix
// column. Gates the owner-only matrix config UI; server enforcement falls
// back to DEFAULT_MATRIX when the column doesn't exist yet, so nothing
// changes behaviourally until the migration is applied. Negatives re-probe
// after a short TTL (capability-probe.ts).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const permissionMatrixAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('permission_matrix').limit(1);
  return !error;
});
