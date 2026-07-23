// Batch 3 E5 — capability probe for migration 0027's documents.position
// column. Gates drag-to-reorder in the Data Room; move-to-folder and
// replace-file don't depend on it. Negatives re-probe after a short TTL.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const documentOrderingAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('documents').select('position').limit(1);
  return !error;
});
