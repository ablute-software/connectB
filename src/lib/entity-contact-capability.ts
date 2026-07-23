// Founder-feedback batch 2, item 1 — capability probe for migration 0024's
// entities.email/phone/address (and, since it's the same migration,
// people.identity_verified/gender). Negatives re-probe after a short TTL
// (see capability-probe.ts).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const entityContactFieldsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('entities').select('email').limit(1);
  return !error;
});
