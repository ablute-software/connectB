// Prompt 106 §C — single source of truth for "find this user's active
// matchdeal_investor_members row." Confirmed live: alexandrameira@ablute.pt
// has had up to 6 active rows at once (1 real + 5 identical-timestamp
// demo-seed rows never cleaned up — see portal-access.ts's P83 Bloco 0
// note). `.maybeSingle()` on a query that can return more than one row
// either throws (a PostgREST error most callers weren't even checking) or
// returns null — either way the caller reads "not linked" for a user who
// very much is. Confirmed independently in 11 call sites; fixed once, here.
// Same "oldest active wins" convention as portal-access.ts already used —
// a real long-standing membership beats anything seeded in later, and it's
// deterministic across repeated calls (unlike picking an arbitrary row).
//
// Prompt 506 — e, desde então, o ponto onde o bloqueio por falta de
// pagamento é aplicado. A razão de ser AQUI e não em cada rota: são 50 call
// sites (medidos), e todos já tratam `null` como "não é investidor com
// assento" — devolver null numa firma em dívida reutiliza um caminho que
// todos já têm, em vez de acrescentar 48 ramos de erro novos que se podem
// esquecer um a um. Falhar fechado por omissão é a propriedade que interessa
// numa porta de acesso.
//
// As rotas que TÊM de continuar a funcionar com a subscrição em falta
// passam `allowBillingLapsed: true` — sem isso, uma firma em dívida ficaria
// sem forma de pagar para voltar, que seria uma ratoeira: /api/stripe/
// investor-checkout, /api/stripe/investor-portal e
// /api/portal/investor-profile (que é quem alimenta o painel de Plans e a
// própria mensagem de bloqueio).
import type { SupabaseClient } from '@supabase/supabase-js';
import { readInvestorFirmBillingAccess } from './investor-billing-access';

export interface ActiveInvestorMember {
  id: string;
  catalog_entity_id: string;
  domain_verified: boolean;
}

export interface ResolveInvestorMemberOptions {
  /** Só para as rotas de pagamento/plans — ver o comentário acima. */
  allowBillingLapsed?: boolean;
}

export async function resolveActiveInvestorMember(
  admin: SupabaseClient, userId: string, opts: ResolveInvestorMemberOptions = {},
): Promise<ActiveInvestorMember | null> {
  const { data, error } = await admin.from('matchdeal_investor_members')
    .select('id, catalog_entity_id, domain_verified')
    .eq('user_id', userId).eq('status', 'active')
    .order('created_at', { ascending: true }).limit(1);
  if (error) {
    console.error('resolveActiveInvestorMember failed:', error.message);
    return null;
  }
  const member = (data?.[0] as ActiveInvestorMember | undefined) ?? null;
  if (!member || opts.allowBillingLapsed) return member;

  const access = await readInvestorFirmBillingAccess(admin, member.catalog_entity_id);
  return access.blocked ? null : member;
}
