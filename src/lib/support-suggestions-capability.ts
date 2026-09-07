import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

// Prompt 605 — migration 0339 (the 'suggestion' category, the
// 'feedback_widget' source and the three suggestion_* columns). Probing the
// COLUMN rather than the table, because support_tickets itself has existed
// since 0036: without 0339 the table is there and the insert would fail on a
// CHECK constraint instead, which is exactly the shape of failure this probe
// exists to keep out of a user's face.
export const supportSuggestionsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('support_tickets').select('suggestion_status').limit(1);
  return !error;
});
