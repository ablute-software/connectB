// Prompt 176 §B — capability probe for migration 0162's
// support_tickets.requester_last_read_at column. Gates the new read-tracking
// logic (both the write in GET /api/support/my-tickets/[id] and the read in
// GET /api/support/my-tickets) until the migration is confirmed applied —
// same pattern as every other propose-only migration in this codebase.
// Pre-migration, both routes fall back to the OLD event-inference logic
// (unread = admin activity newer than the requester's own last reply) —
// never a hard error, same "degrade gracefully" rule support-capability.ts
// itself documents for the table's own existence.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const supportRequesterReadAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('support_tickets').select('requester_last_read_at').limit(1);
  return !error;
});
