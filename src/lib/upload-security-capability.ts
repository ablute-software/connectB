// Prompt 301 §3 — capability probe for migration 0205's malware_scan_*
// columns on documents/document_versions. Negatives re-probe after a short
// TTL, same as every other probe in this codebase.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const malwareScanAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('documents').select('malware_scan_status').limit(1);
  return !error;
});
