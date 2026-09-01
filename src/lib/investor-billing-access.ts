// Prompt 506 — "sem acesso por falta de pagamento", separado de qual é o
// tier. A metade PURA aqui em cima (testável sem base de dados), a leitura
// no fim.
//
// O estado vive em `investor_billing.access_state` (migração 0288), ao nível
// da FIRMA — o mesmo grão de todo o billing do investidor. Ver a migração
// para porque não pode ser um valor de `matchdeal_profiles.plan_tier` (o
// CHECK dessa coluna e o fallback `else` de matchdeal_tier_limits, os dois
// medidos no schema real) nem o 'suspended' de moderação.
import type { SupabaseClient } from '@supabase/supabase-js';

export type InvestorAccessState = 'active' | 'payment_lapsed';

export function isBlockedState(state: string | null | undefined): boolean {
  // Fail-CLOSED sobre um valor conhecido de bloqueio, e fail-OPEN sobre
  // ausência: uma firma sem linha em investor_billing é uma firma que nunca
  // passou por billing nenhum (todas as de hoje), e essas não podem começar
  // a ser bloqueadas por este código existir.
  return state === 'payment_lapsed';
}

// O que o webhook deve escrever em cada caso. Puro de propósito: é a regra
// que o Prompt 506 corrige, e é a que tem de estar coberta por teste.
export function accessStateForSubscription(paying: boolean): InvestorAccessState {
  return paying ? 'active' : 'payment_lapsed';
}

export interface InvestorFirmBillingAccess {
  state: InvestorAccessState;
  blocked: boolean;
  /** O último tier pago (investor_billing.plan_tier) — para "Reactivate Ace Spotter". */
  lastPaidTier: string | null;
}

// Leitura por firma. Um erro de infraestrutura (tabela/coluna ainda sem
// migração aplicada) devolve 'active' — a mesma convenção de degradar em
// vez de partir que o middleware já documenta para account_access_state(),
// e a diferença entre "não consegui saber" e "sei que está em dívida" não
// deve trancar ninguém fora por causa de uma ordem de deploy.
export async function readInvestorFirmBillingAccess(
  admin: SupabaseClient, catalogEntityId: string,
): Promise<InvestorFirmBillingAccess> {
  const { data, error } = await admin.from('investor_billing')
    .select('access_state, plan_tier').eq('catalog_entity_id', catalogEntityId).maybeSingle();
  if (error) {
    console.error('readInvestorFirmBillingAccess failed:', error.message);
    return { state: 'active', blocked: false, lastPaidTier: null };
  }
  const state = (data?.access_state as InvestorAccessState | undefined) ?? 'active';
  return { state, blocked: isBlockedState(state), lastPaidTier: (data?.plan_tier as string | null) ?? null };
}
