// Prompt 268 (251/253 Bloco D) — capability probe for migration 0191's
// reawakening_ai_filter_cache table. Gates /api/reawakening/rejection-filter;
// the AI call itself additionally needs ANTHROPIC_API_KEY (checked in the
// route, same split as reawakening-capability.ts). Negatives re-probe after
// a short TTL.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const reawakeningAiFilterAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('reawakening_ai_filter_cache').select('id').limit(1);
  return !error;
});
