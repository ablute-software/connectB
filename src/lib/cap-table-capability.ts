// Prompt 434 §C — migration 0271's convertible-note columns on
// cap_table_entries (is_convertible/conversion_*/agreement_document_id).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const capTableConvertibleFieldsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('cap_table_entries').select('is_convertible').limit(1);
  return !error;
});
