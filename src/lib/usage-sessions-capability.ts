// Prompt 295 — migration 0203 (usage_sessions, metrics_snapshots). Two
// separate probes since either table could in principle land without the
// other (same additive-migration caution as every other probe this
// session), even though this migration always applies both together.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const usageSessionsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('usage_sessions').select('id').limit(1);
  return !error;
});

export const metricsSnapshotsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('metrics_snapshots').select('id').limit(1);
  return !error;
});
