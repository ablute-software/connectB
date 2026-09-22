// Prompt 716 §8 — "os alertas ficam desligados por feature flag até o 715
// Pedido A estar em produção". Rather than a manually-flipped boolean (one
// more thing to remember to turn on), this gates on the REAL schema that
// Pedido A actually ships: the moment investor_signal_events exists in an
// environment, alerts/reapresentation switch on there automatically — the
// same makeCapabilityProbe pattern this codebase already uses for every
// other migration-gated feature (roundValuationBasisAvailable,
// interactionLogAvailable, pipelineTestFlagAvailable, …).
import { makeCapabilityProbe } from './capability-probe';

export const reevaluationAlertsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('investor_signal_events').select('id').limit(1);
  return !error;
});

// Prompt 717 Part D — 716's own table, gating the founder-facing condition
// label specifically (an environment can have 715 applied without 716 yet —
// the reverse is impossible, 716's own migration FK-references 715's
// investor_opportunity_episodes, but checking 716's own table directly is
// still the honest, self-updating signal for THIS capability).
export const reevaluationConditionsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('investor_reevaluation_conditions').select('id').limit(1);
  return !error;
});
