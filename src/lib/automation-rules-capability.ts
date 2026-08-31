import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

// Prompt 498 — porta o sweep de regras (automation-rules-tick-server.ts) ao
// alargamento do CHECK de `tasks.source` da migração 0286. Sem ela, cada
// insert do sweep rebentaria na constraint; com ela, /api/automations degrada
// para no-op silencioso num ambiente onde a migração ainda não correu — o
// mesmo contrato de todos os outros jobs deste route.
//
// Um select de coluna não consegue ver valores de constraint, daí a RPC de
// introspecção que a própria migração define (mesma solução, mesma razão que
// entities-source-expanded-capability.ts).
export const automationRulesSweepAvailable = makeCapabilityProbe(async (admin) => {
  const { data, error } = await admin.rpc('tasks_source_automation_sweep_ready');
  return !error && data === true;
});
