// Prompt 360 Part A — migration 0241's two new tables.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const orgMarketDataAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('org_market_data').select('org_id').limit(1);
  return !error;
});

export const marketResearchItemsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('market_research_items').select('id').limit(1);
  return !error;
});
