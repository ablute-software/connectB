// Prompt 293 §1 — migration 0202 (ai_call_log). Same makeCapabilityProbe
// pattern as every other additive migration this session.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const aiCallLogAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('ai_call_log').select('id').limit(1);
  return !error;
});
