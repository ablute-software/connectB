// Prompt 203 §A — registo de consumo da quota Watson, com a falha visível.
//
// Antes: `.then(() => {}, () => {})` em compose/route.ts. Falhar aqui
// significa draft entregue e consumo NÃO registado, ou seja quota fictícia —
// a mesma classe do bug B (best-effort mudo em contabilidade), do outro lado
// do produto.
//
// A decisão não é passar a falhar o pedido: deitar fora um draft já gerado (e
// já pago em tokens) por causa de uma falha de contabilidade é pior do que
// registá-la. Mas "não falhar" não pode significar "não ver" — daí o log com
// contexto e o booleano que o chamador devolve na resposta.
//
// A função SQL (0102) é a segunda linha de defesa, com o cap
// `least(v_used+1, p_quota)` e `for update` lá dentro: o risco que sobra aqui
// é o under-count por erro de rede/RPC, não o over-count. Por isso chega
// registar — sem retry, sem transação.

import type { SupabaseClient } from '@supabase/supabase-js';

export async function recordWatsonDraft(
  sb: SupabaseClient, orgId: string, quota: number,
): Promise<boolean> {
  const { error } = await sb.rpc('watson_record_draft', { p_org_id: orgId, p_quota: quota });
  if (error) {
    console.error('[compose] watson_record_draft falhou — draft entregue sem consumo registado', {
      orgId, error: error.message,
    });
    return false;
  }
  return true;
}
