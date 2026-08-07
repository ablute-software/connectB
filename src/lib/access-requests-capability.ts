// Prompt 121 §2.5/§2.6-invite capability probe — migration 0114 (confirmed
// applied in production, 2026-08-06). Negatives re-probe after a short TTL
// (see capability-probe.ts) so a preview/dev env that hasn't applied it yet
// still picks it up within ~60s once it does.
// Gates: the "Access requested" tab's real content, the "Invite {email} to
// the data room" button for an unmatched search, and the guest preview page.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const accessRequestsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('access_requests').select('id').limit(1);
  return !error;
});

export const guestGrantTokenAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('access_grants').select('guest_token').limit(1);
  return !error;
});
