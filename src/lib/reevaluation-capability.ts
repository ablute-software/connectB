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
