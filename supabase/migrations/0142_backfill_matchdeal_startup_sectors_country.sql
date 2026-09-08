-- =============================================================================
-- PROMPT 620 §A — KEPT, DELIBERATELY, AGAINST THE INSTRUCTION. Measured first.
--
-- 620 §A asked for 0142 and 0143 to be deleted, on the reading that they are
-- the two files that landed in the ledger under other names
-- (matchdeal_test_flag_admin_functions, matchdeal_deck_symmetric_is_test).
-- They are not. Those two are 0141 and 0144, which exist in this directory
-- under exactly those names.
--
-- 0143 was deleted, and for a stronger reason than the prompt gave: its body
-- REPLACES support_tickets_source_check with a five-value list, so applying it
-- today would silently drop 'blocked' and 'feedback_widget'. It was not a
-- duplicate, it was a regression waiting for someone to run it.
--
-- THIS file is the opposite case: its effect is NOT in production. Measured
-- 2026-09-08, ten of fourteen startup profiles still diverge, and most have an
-- EMPTY matchdeal_profiles.sectors against a populated orgs.sectors —
--
--   Sherlock Deal        orgs [Enterprise Software & SaaS, AI Data & Analytics]  profile []
--   Estojo               orgs [AgriTech & FoodTech, ClimateTech, BlueTech]       profile []
--   Krohnsty             orgs [Longevity AgeTech, AgriTech & FoodTech]           profile []
--   ...and seven more
--
-- matchdeal_eligible_deck() matches on matchdeal_profiles.sectors, so those
-- ten are being matched on an empty array. Deleting this file would have
-- thrown away a pending fix for a live defect, not a duplicate.
--
-- It stays PROPOSED: it is a data write that changes what investors are shown,
-- and the file's own header already says it needs Nuno's decision. Neither
-- 0142 nor 0143 contains a revoke, a grant or an RLS policy, so §A's safety
-- condition passed for both — but that condition was not the test that
-- mattered here. The test that mattered was "is the effect already in
-- production", and for this file the answer is no.
-- =============================================================================

-- =============================================================================
-- 0142_backfill_matchdeal_startup_sectors_country.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro:
--   mini_prompt_lote_C_pipeline_dados_itens_3_15_20260806.md §3.3
--
-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- orgs.sectors/country e matchdeal_profiles.sectors/country (kind='startup')
-- ja divergiam em producao antes desta migracao. Medido directamente:
--
--   org               | orgs.sectors                          | matchdeal_profiles.sectors
--   Caramel Biscuit    | [Digital Health]                      | []
--   Test & trial       | [Animal Health, Mental Health]        | []
--   Sherlock Deal_ test | []                                    | [saas, health]
--   ablute_             | [health, deeptech, wellness, hardware] | [health, deeptech, wellness, hardware]
--
-- Nao e so divergencia de conteudo -- e tambem de CASING/taxonomia
-- ("Digital Health" vs "health"/"digital health"), que esta migracao NAO
-- resolve (ver nota no fim).
--
-- =============================================================================
-- PORQUE orgs E CANONICO -- ja e a intencao documentada, so nunca foi fechada
-- =============================================================================
-- migracao 0098 ja criou um trigger de sincronizacao orgs -> matchdeal_profiles
-- (sectors e country), e o proprio comentario dessa migracao ja dizia:
-- "ProfilePanel.tsx's read-only orgs block needs them to reflect the Sherlock
-- Deal settings value once ProfilePanel stops offering a second edit form
-- for them." Ou seja: a intencao SEMPRE foi orgs ser a fonte, e
-- matchdeal_profiles ser o espelho -- so faltou ProfilePanel deixar de
-- oferecer a segunda forma de edicao. Esse lado (codigo) esta corrigido no
-- commit companheiro (ProfilePanel.tsx: sectors/country passam a read-only
-- para kind='startup', tal como description/website ja eram). Esta migracao
-- e so o backfill de dados para as linhas que ja tinham divergido antes
-- dessa correccao -- o trigger 0098 so actua em orgs UPDATEs futuros, nunca
-- retroactivamente.
--
-- matchdeal_eligible_deck() continua a ler matchdeal_profiles.sectors, NUNCA
-- orgs.sectors -- isto nao muda. Depois deste backfill, os dois valores
-- ficam iguais para startups, portanto o motor de matching passa a ver o
-- valor correcto sem lhe tocar uma linha.
--
-- =============================================================================
-- O QUE ESTA MIGRACAO NAO FAZ
-- =============================================================================
-- Nao normaliza a taxonomia (maiusculas/minusculas, sinonimos como "digital
-- health" vs "health, wellness"). Isso e uma decisao de PRODUTO -- qual e a
-- lista canonica de sectores -- nao uma correccao de dados. Fica sinalizado,
-- nao decidido aqui: se os valores nao forem normalizados, o matching por
-- overlap de array (`p.sectors && v_viewer.sectors`) continua a falhar por
-- comparacao de string mesmo com os dados "certos" em ambos os lados.
--
-- Nao toca em matchdeal_eligible_deck nem em access_grants.
-- =============================================================================

begin;

update public.matchdeal_profiles p
set sectors = o.sectors, country = o.country, updated_at = now()
from public.orgs o
where p.membership_id = o.id
  and p.kind = 'startup'
  and (p.sectors is distinct from o.sectors or p.country is distinct from o.country);

commit;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select o.name, o.sectors as org_sectors, p.sectors as profile_sectors,
--        o.country as org_country, p.country as profile_country
-- from public.matchdeal_profiles p join public.orgs o on o.id = p.membership_id
-- where p.kind = 'startup';
-- Esperado: org_sectors = profile_sectors e org_country = profile_country
-- em todas as linhas (os 5 perfis orfaos de e1000000-... nao aparecem aqui,
-- o join com orgs falha para eles por desenho -- ver DECISIONS.md).
-- =============================================================================
