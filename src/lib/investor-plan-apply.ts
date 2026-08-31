import 'server-only';
// Prompt 501 — a aplicação do tier a uma FIRMA, extraída de
// /api/backoffice/set-investor-plan/route.ts para o webhook do Stripe poder
// usar exactamente a mesma, e não uma segunda cópia à letra que pudesse
// divergir. O prompt pede isto explicitamente, e a razão é concreta: a
// semântica "um plano por firma, aplicado a TODOS os assentos activos de uma
// vez" é o coração do modelo de billing do lado investidor (o mesmo espírito
// do limite de assentos do 497). Duas implementações dela seriam duas
// respostas possíveis à pergunta "quem é que este pagamento cobre".
//
// O que fica DE FORA daqui, de propósito, porque é específico de cada
// chamador e não da regra: o log de auditoria de admin (só o backoffice tem
// um admin a registar) e o email de notificação (o backoffice notifica uma
// decisão humana; o Stripe já envia o seu próprio recibo).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ApplyInvestorTierResult {
  /** Assentos activos da firma no momento da aplicação. */
  members: { id: string; user_id: string }[];
  /** O tier que a firma tinha antes — null se não havia nenhum assento com valor. */
  previousTier: string | null;
  /** Mensagem de erro, quando a aplicação falhou. `members` vem vazio nesse caso. */
  error?: string;
}

// `tier` é o código MatchDeal ('tier_a'/'tier_b'/'tier_c'), não o
// InvestorPlanTier — é o vocabulário que matchdeal_profiles.plan_tier guarda.
// A tradução faz-se antes de chegar aqui (INVESTOR_PLAN_TO_MATCHDEAL_TIER).
export async function applyInvestorTierToFirm(
  admin: SupabaseClient, catalogEntityId: string, tier: string,
): Promise<ApplyInvestorTierResult> {
  const { data: memberRows } = await admin.from('matchdeal_investor_members')
    .select('id, user_id').eq('catalog_entity_id', catalogEntityId).eq('status', 'active');
  const members = (memberRows ?? []) as { id: string; user_id: string }[];
  if (members.length === 0) return { members: [], previousTier: null, error: 'No active seats for this firm.' };
  const memberIds = members.map((m) => m.id);

  const { data: profilesBefore } = await admin.from('matchdeal_profiles')
    .select('plan_tier').eq('kind', 'investor').in('membership_id', memberIds).limit(1);
  const previousTier = (profilesBefore?.[0]?.plan_tier as string | undefined) ?? null;

  // Um único update sobre TODOS os assentos — não um por pessoa. Limpa também
  // plan_tier_requested/_at: um pedido pendente que sobrevivesse à aplicação
  // é exactamente o bug que o item 11 reportou no backoffice, e um pagamento
  // real torna o pedido manual obsoleto pela mesma razão.
  const { error } = await admin.from('matchdeal_profiles')
    .update({ plan_tier: tier, plan_tier_requested: null, plan_tier_requested_at: null })
    .eq('kind', 'investor').in('membership_id', memberIds);
  if (error) return { members: [], previousTier, error: error.message };

  return { members, previousTier };
}
