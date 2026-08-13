-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro: prompt_184_desacoplar_pipeline_investidor_do_matchdeal_20260813.md §2

-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- owner_suspended_at/platform_suspended_at (migracao 0105) vivem so em
-- matchdeal_profiles. Uma org que nunca tocou no MatchDeal nao tem nenhuma
-- linha ai -- nao ha onde gravar "esconder-me da Pipeline do investidor"
-- para essa org, mesmo com o perfil CRM 100% completo (o mesmo bug de fundo
-- que a Caramel Biscuit expos para is_visible, agora para suspensao).
--
-- =============================================================================
-- DECISAO (confirmada antes de escrever esta migracao, per §2 do prompt)
-- =============================================================================
-- DUPLICAR, nao mover. Verificado: o toggle Visible/Suspended
-- (VisibilityToggle.tsx -> /api/company/visibility) e HOJE o UNICO sitio que
-- escreve matchdeal_profiles.owner_suspended_at para kind='startup' -- e e
-- essa escrita que tambem esconde a startup do proprio deck de swipe do
-- MatchDeal (via matchdeal_profiles.is_visible, migracao 0105). O prompt §3
-- e explicito: "nao mexer" no criterio do MatchDeal. Mover as colunas para
-- fora de matchdeal_profiles pararia de facto de esconder a startup do
-- MatchDeal na proxima vez que o founder carregasse em "Suspend" -- uma
-- regressao silenciosa a uma coisa que hoje funciona, nao pedida em lado
-- nenhum. Duplicar mantem o toggle a fazer exactamente o que faz hoje nos
-- dois sitios, com orgs a tornar-se a fonte usada pela elegibilidade da
-- Pipeline (nao MatchDeal-dependente).
--
-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- 1) orgs.owner_suspended_at / orgs.platform_suspended_at / (a companheira
--    suspension_reminded_at, para o lembrete mensal "ainda suspenso?" do
--    proprio VisibilityToggle.tsx funcionar tambem para uma org sem linha
--    em matchdeal_profiles -- nao pedida explicitamente no prompt mas
--    necessaria para o MESMO toggle nao ficar parcialmente quebrado).
-- 2) Backfill a partir de matchdeal_profiles (kind='startup') -- uma org ja
--    suspensa hoje continua suspensa amanha, nunca reaparece na Pipeline so
--    por causa desta migracao.
-- =============================================================================

alter table public.orgs
  add column owner_suspended_at timestamptz,
  add column platform_suspended_at timestamptz,
  add column suspension_reminded_at timestamptz;

update public.orgs o
set owner_suspended_at = mp.owner_suspended_at,
    platform_suspended_at = mp.platform_suspended_at,
    suspension_reminded_at = mp.suspension_reminded_at
from public.matchdeal_profiles mp
where mp.membership_id = o.id and mp.kind = 'startup'
  and (mp.owner_suspended_at is not null or mp.platform_suspended_at is not null or mp.suspension_reminded_at is not null);

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select o.id, o.name, o.owner_suspended_at, mp.owner_suspended_at as matchdeal_owner_suspended_at
-- from public.orgs o
-- left join public.matchdeal_profiles mp on mp.membership_id = o.id and mp.kind = 'startup'
-- where o.owner_suspended_at is not null or mp.owner_suspended_at is not null;
-- -- Esperado: os dois valores iguais para cada org devolvida (backfill correcto).
-- =============================================================================
