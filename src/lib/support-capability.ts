// Contact & Support — capability probe for migration 0036 (support_tickets).
// Same pattern as company-canon.ts: the public /contact form and the
// founder/investor "Help & support" widget must never show a broken/technical
// state before the migration is applied — they degrade to a generic "thanks"
// with nothing written, rather than erroring.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const supportTicketsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('support_tickets').select('id').limit(1);
  return !error;
});
