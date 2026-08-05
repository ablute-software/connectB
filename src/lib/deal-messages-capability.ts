// P134-C — propose-only migration (0126, deal_threads/deal_messages). Same
// pattern as every other migration-gated feature (capability-probe.ts):
// lets messaging light up the moment Nuno applies the migration, with no
// code deploy needed.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const dealMessagesAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('deal_threads').select('id').limit(1);
  return !error;
});
