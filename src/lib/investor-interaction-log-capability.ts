// P133 (item 10) — propose-only migration (0125, investor_interaction_log).
// Same pattern as every other migration-gated feature (capability-probe.ts):
// lets the Interaction log light up the moment Nuno applies the migration,
// with no code deploy needed.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const interactionLogAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('investor_interaction_log').select('id').limit(1);
  return !error;
});

// P134-D (§4) — propose-only migration 0130 (person_id/person_name_other/
// document_id on investor_interaction_log). Separate from the probe above:
// 0125 and 0130 are independent migrations Nuno applies one at a time, and
// selecting a column that doesn't exist yet fails the whole query (not
// just that field) — same two-literal-select-string pattern
// round-valuation-basis-capability.ts already established for this exact
// situation.
export const interactionLogPersonDocumentAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('investor_interaction_log').select('person_id, person_name_other, document_id').limit(1);
  return !error;
});
