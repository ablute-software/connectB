import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

// Prompt 179 §B — gates the monthly catalog delivery job (migration 0165)
// so /api/automations degrades to a no-op, not an error, on any environment
// where the migration hasn't been applied yet.
export const catalogMonthlyDeliveryAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('catalog_last_monthly_delivery').limit(1);
  return !error;
});
