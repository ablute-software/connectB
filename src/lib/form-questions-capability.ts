// Prompt 265 §7 — capability probe for migration 0188 (catalog_form_questions),
// PROPOSED, not yet applied. Same shape as every other migration-gated
// feature in this codebase (access-requests-capability.ts, etc.): a cheap
// "does this table exist yet" check, cached, negatives re-probed after a
// short TTL. Gates the shared-cache read/write in the form-questions route
// only — extraction itself works with or without this table (it just can't
// reuse a prior org's result, or save its own, until the migration lands).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const catalogFormQuestionsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('catalog_form_questions').select('id').limit(1);
  return !error;
});
