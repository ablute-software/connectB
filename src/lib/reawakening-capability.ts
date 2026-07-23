// F — capability probe for migration 0030's reawakening_proposals table. Gates
// the Pipeline reawakening queue and the fact-confirmation trigger's storage.
// The AI itself also needs ANTHROPIC_API_KEY (checked in the route); this probe
// only reports whether the proposals table exists. Negatives re-probe after a
// short TTL.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const reawakeningAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('reawakening_proposals').select('id').limit(1);
  return !error;
});
