// Prompt 124 D10 — propose-only migration 0122 (app_events table, used by
// C2 page_view and any future generic event). Gates the write routes so
// they degrade to a no-op (not an error) pre-migration.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const appEventsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('app_events').select('id').limit(1);
  return !error;
});
