-- Prompt 501 — billing do investidor: o Stripe a sério do lado da firma.
--
-- ONDE VIVEM `stripe_customer_id`/`stripe_subscription_id`, e porque NÃO em
-- `catalog_entities` (a proposta do prompt, recusada com medição):
--
-- O grão está certo — o tenant do lado investidor é a FIRMA
-- (`catalog_entity_id`, o mesmo que set-investor-plan já usa para aplicar o
-- tier a todos os assentos de uma vez), não a pessoa nem o assento. O que
-- está errado é a tabela, porque `catalog_entities` e `orgs` têm posturas de
-- RLS OPOSTAS:
--
--   orgs             -> policy `org_select` USING (is_org_member(id))
--                       => só os membros da própria org lêem a linha.
--                          É por isso que `orgs.stripe_customer_id` é seguro.
--   catalog_entities -> policy `catalog_read` para PUBLIC
--                       USING (verification_status = 'verified'
--                              OR is_platform_admin())
--                       => QUALQUER pessoa, incluindo `anon` sem sessão, lê
--                          qualquer linha verificada. É um catálogo público:
--                          é essa a sua função.
--
-- Medido em produção antes de decidir (31/08/2026): 357 das 531 linhas de
-- `catalog_entities` são 'verified' e portanto legíveis pelo mundo, e 2 das 4
-- firmas que hoje têm assentos activos estão entre elas. Seguir a proposta à
-- letra publicaria o stripe_customer_id e o stripe_subscription_id dessas
-- firmas no PostgREST público desde o primeiro dia. Não é teórico.
--
-- Daí uma tabela dedicada, com RLS ligada e ZERO policies, revogada de
-- anon/authenticated: só o service_role lhe toca — e as três rotas que
-- precisam dela (investor-checkout, webhook, investor-portal) já usam o
-- cliente de service role, tal como as suas equivalentes do lado founder.
-- O painel do investidor nunca precisa do customer id: só de saber SE a
-- firma tem subscrição, um booleano que o servidor calcula e devolve.
create table if not exists public.investor_billing (
  -- PK e não apenas FK: "uma firma só pode ter UMA subscrição activa de cada
  -- vez" (medição §3 do prompt) passa a ser uma garantia do Postgres, não uma
  -- verificação que a rota de checkout espera lembrar-se de fazer.
  catalog_entity_id uuid primary key references catalog_entities(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  -- O tier e a cadência que o Stripe diz estarem em vigor. `plan_tier` aqui é
  -- o código MatchDeal ('tier_a'/'tier_b'/'tier_c'), o mesmo vocabulário de
  -- matchdeal_profiles.plan_tier, para não haver duas traduções em jogo.
  plan_tier text,
  billing_period text, -- 'monthly' | 'annual'
  updated_at timestamptz not null default now()
);

alter table public.investor_billing enable row level security;
-- Sem policies de propósito: com RLS ligada e nenhuma policy, todo o acesso
-- por roles que respeitam RLS é negado. O revoke abaixo tira também o
-- privilégio de tabela, para não depender só da RLS.
revoke all on table public.investor_billing from anon, authenticated;

-- Índice para a resolução inversa do webhook (subscription -> firma) quando
-- um evento traz a subscrição mas a metadata vier vazia.
create index if not exists investor_billing_subscription_idx
  on public.investor_billing (stripe_subscription_id)
  where stripe_subscription_id is not null;
