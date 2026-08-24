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

// Prompt 370 §C — migration 0242's columns (source_kind/document_id/page/
// structured) on the same table above; probed separately since a org on
// an unmigrated deploy still has the table but not these columns yet.
export const marketDocumentExtractionAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('market_research_items').select('source_kind, document_id, page, structured').limit(1);
  return !error;
});
