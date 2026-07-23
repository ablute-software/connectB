// E7 — capability probe for migration 0029's document_versions table. Gates
// the "Nova versão" flow + version list in the Data Room; the legacy Replace
// behaviour stays until this lands. Negatives re-probe after a short TTL.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const documentVersionsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('document_versions').select('id').limit(1);
  return !error;
});
