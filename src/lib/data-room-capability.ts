// Data Room V2 capability probes. Negatives re-probe after a short TTL (see
// capability-probe.ts) so a just-applied migration is picked up within ~60s
// instead of never.
//   - documentDetailsAvailable: migration 0022 (documents.details).
//   - ndaSystemAvailable: migration 0023 (ndas table).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const documentDetailsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('documents').select('details').limit(1);
  return !error;
});

export const ndaSystemAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('ndas').select('id').limit(1);
  return !error;
});
