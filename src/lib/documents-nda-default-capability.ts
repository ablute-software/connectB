// Prompt 742 §A.1 — documents.nda_by_default (migration 20260926124802).
// Same probe-and-fall-back shape as data-room-capability.ts's own
// documentDetailsAvailable/ndaSystemAvailable: an environment that hasn't
// applied the migration yet keeps working exactly as before (requiresNda()
// falls back to due_diligence-only, since the column is simply absent from
// every select rather than erroring it).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const documentNdaByDefaultAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('documents').select('nda_by_default').limit(1);
  return !error;
});
