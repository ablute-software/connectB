// Prompt 292 §Fase 1 — migration 0201 (market_companies,
// investor_investments — both brand new tables). Same makeCapabilityProbe
// pattern as every other additive migration this session; checking
// market_companies alone is enough since both tables land together in the
// same migration file (never applied independently of each other).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const competitorInvestmentsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('market_companies').select('id').limit(1);
  return !error;
});
