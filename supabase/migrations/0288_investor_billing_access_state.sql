-- Prompt 506 — cancelar deixa a firma SEM ACESSO, não no tier mais barato.
--
-- Decisão do Nuno: "se descer escolherá o plano adequado. se deixar de pagar
-- fica sem acesso até pagar." O Prompt 501 descia ao
-- INVESTOR_PLAN_FLOOR_MATCHDEAL_TIER ('tier_a') num cancelamento, o que dava
-- Pro Scout de graça a quem parou de pagar.
--
-- PORQUE É UMA COLUNA NOVA E NÃO UM VALOR EM `matchdeal_profiles.plan_tier`
-- — as duas razões foram MEDIDAS no schema real, não assumidas:
--   1. `matchdeal_profiles_plan_tier_check` limita plan_tier a exactamente
--      ('tier_a','tier_b','tier_c'). Não há como escrever um sentinela.
--   2. Mesmo que houvesse: `matchdeal_tier_limits(p_tier)` faz
--      `case ... else 3 / else 1 / else 0`, ou seja um tier DESCONHECIDO cai
--      nos limites do tier_a em vez de zero. Um sentinela não bloquearia
--      nada — daria exactamente o Pro Scout grátis que se quer evitar.
-- E 'tier_a' já é o fallback estabelecido de "esta firma nunca teve tier"
-- em portal-access.ts, investor-pipeline.ts e backoffice-metrics.ts (todos
-- com `?? 'tier_a'`): escrevê-lo num cancelamento tornaria "nunca assinou",
-- "cancelou" e "está no Pro Scout a pagar" indistinguíveis, e só o terceiro
-- deve ter acesso.
--
-- PORQUE AQUI E NÃO EM `account_moderation_actions`: aquele mecanismo é para
-- fraude/abuso, decidido por um humano do back-office. Uma firma com a
-- fatura em atraso não é uma conta suspeita, e misturá-las poria uma na fila
-- de moderação da outra.
--
-- O grão é a FIRMA, como todo o resto do billing do investidor
-- (investor_billing tem catalog_entity_id como PK), não o assento: um plano
-- cobre todos os assentos activos, logo a falta dele também.
alter table public.investor_billing
  add column if not exists access_state text not null default 'active'
  check (access_state in ('active', 'payment_lapsed'));

comment on column public.investor_billing.access_state is
  'active = a firma pode usar a plataforma; payment_lapsed = a subscrição foi cancelada/terminada e o acesso está bloqueado até novo pagamento. Escrito só pelo webhook do Stripe. NÃO é moderação (fraude/abuso) — ver account_moderation_actions para isso.';

-- `investor_billing.plan_tier` continua a guardar o ÚLTIMO tier pago, e
-- `matchdeal_profiles.plan_tier` fica intocado num cancelamento (ver o
-- webhook): não há valor que signifique "nenhum" (ver acima), e manter o
-- último tier é o que permite dizer "Reactivate Ace Spotter" em vez de um
-- genérico "subscreva". Com o acesso bloqueado à parte, um plan_tier antigo
-- não dá direito a nada por si só.
