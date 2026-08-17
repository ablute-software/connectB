// Prompt 219 bloco 3 (Prompt 223) — sonda das migrações do motor de
// narrativa, no mesmo padrão de todas as outras funcionalidades gated por
// migração (capability-probe.ts). Duas sondas separadas porque são duas
// migrações que o revisor aplica em momentos diferentes: a 0176
// (company_claims) já está em produção, a 0179 (blueprint_analyses) não.
//
// Sem isto, o separador do Blueprint rebentava com 500 em vez de dizer
// honestamente que ainda não está ligado.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const claimsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('company_claims').select('id').limit(1);
  return !error;
});

export const blueprintAnalysesAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('blueprint_analyses').select('id').limit(1);
  return !error;
});
