import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

// Prompt 601 — migration 0337 (platform_badges). Every reader degrades to
// "no badges" on an environment that hasn't applied it, instead of erroring.
export const platformBadgesAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('platform_badges').select('id').limit(1);
  return !error;
});
