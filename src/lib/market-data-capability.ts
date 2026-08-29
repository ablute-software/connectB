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

// Prompt 373 — migration 0246's new tables/columns.
export const orgMarketRingsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('org_market_rings').select('id').limit(1);
  return !error;
});

export const orgCompetitorsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('org_competitors').select('id').limit(1);
  return !error;
});

export const marketCompanyExtendedFieldsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('market_companies').select('company_type, life_status, latest_news').limit(1);
  return !error;
});

export const marketCompanyFlagsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('market_company_flags').select('id').limit(1);
  return !error;
});

export const marketGroupsVisibilityAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('market_groups_visible_to_investors').limit(1);
  return !error;
});

// Prompt 444 §A/§B — migration 0272's two new tables.
export const marketThesisAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('org_market_thesis').select('org_id').limit(1);
  return !error;
});

export const marketHypothesesAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('org_market_hypotheses').select('id').limit(1);
  return !error;
});
