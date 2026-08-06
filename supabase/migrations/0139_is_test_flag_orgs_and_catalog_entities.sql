-- 0139 — Sinalizador estrutural de dados de teste/internos.
--
-- Contexto (item 15 da checklist de 06/08/2026): não existe, em lado nenhum
-- do schema, qualquer forma de distinguir uma conta interna/de teste de uma
-- conta real. Confirmado via information_schema.columns: nem orgs, nem
-- catalog_entities, nem matchdeal_profiles têm is_test/is_internal. O único
-- mecanismo existente é is_ablute_developer() (domínio @ablute.pt), que (1)
-- só bloqueia ESCRITAS a partir da rota da Pipeline, nunca filtra leituras,
-- (2) não cobre contas gmail-styled usadas internamente, (3) não tem efeito
-- sobre access_grants.
--
-- Consequência medida em produção antes desta migração: o org
-- c21efeda ("Sherlock Deal_ test") tem matchdeal_profiles.is_visible = true
-- e is_complete = true, ou seja aparece como card de "Tracking" na Pipeline
-- de QUALQUER investidor real da plataforma.
--
-- Esta migração é ADITIVA e INERTE por si só: acrescenta a coluna e marca as
-- linhas já identificadas. Nada muda no comportamento da aplicação até que o
-- código passe a filtrar por is_test (eligiblePipelineOrgIds,
-- activeGrantOrgIds, computeTrackingCountsByStage) — deliberado, para que a
-- marcação possa ser revista antes de ter qualquer efeito visível.
--
-- NÃO toca em access_grants nem em matchdeal_eligible_deck.

alter table public.orgs
  add column if not exists is_test boolean not null default false;

alter table public.catalog_entities
  add column if not exists is_test boolean not null default false;

-- Item verbatim (relatorio_verificacao_40a0835_e_reposicao_is_test_20260806
-- §4): estes dois literais tem de ficar SEM acentuacao e com hifen simples,
-- byte a byte iguais ao texto que passou por apply_migration em producao
-- (version 20260806202717, md5 dos statements c6e69455c0e0a8b8c02e1f02bc492a39)
-- -- nao "corrigir" a acentuacao aqui, isso reabre exactamente a divergencia
-- repo-vs-producao que este ficheiro existe para fechar.
comment on column public.orgs.is_test is
  'Org interna/de teste da equipa. Deve ser excluida da descoberta publicada e de qualquer estatistica agregada mostrada a utilizadores reais.';
comment on column public.catalog_entities.is_test is
  'Entidade investidora interna/de teste. Mesma semantica de orgs.is_test.';

create index if not exists orgs_is_test_idx on public.orgs (is_test) where is_test;
create index if not exists catalog_entities_is_test_idx on public.catalog_entities (is_test) where is_test;

-- Backfill dos casos confirmados por inspecção directa da base em 06/08/2026.
--
-- ATENÇÃO ao caso 'ablute_' (bca54499): este org é simultaneamente o dogfood
-- da equipa E o alvo de ABLUTE_ORG_ID em
-- src/app/api/backoffice/investor-access-requests/[id]/approve/route.ts, que
-- concede a Data Room do ablute_ a leads de investidor REAIS. Marcar is_test
-- aqui é correcto do ponto de vista de "isto é a nossa própria conta", mas
-- quem implementar o filtro tem de garantir que NÃO parte esse fluxo: o
-- filtro de is_test em activeGrantOrgIds não pode fazer desaparecer o acesso
-- de um investidor real aprovado pelo backoffice. O comentário da própria
-- rota já antecipa a solução (um selector de org/pasta quando existir um
-- segundo org real).
update public.orgs set is_test = true
where id in (
  'bca54499-03c8-469b-a48d-b9f442e44f69',  -- ablute_ (dogfood da equipa)
  'c21efeda-022e-46cf-beca-c0f93d3d5c6c',  -- Sherlock Deal_ test
  '4d746b5d-5ae0-44c2-866b-df8660f25007',  -- Test & trial
  '45e28905-0a9c-42d8-bcd0-a0ba447484c6'   -- Caramel Biscuit (criado por alexandrameira.ablute@gmail.com)
);

update public.catalog_entities set is_test = true
where id in (
  'd0000000-0000-4000-8000-000000000001',  -- Northbound Ventures (demo)
  'd0000000-0000-4000-8000-000000000002',  -- Tagus Health Capital (demo)
  'd0000000-0000-4000-8000-000000000003',  -- Lisbon Family Office (demo)
  'd0000000-0000-4000-8000-000000000004',  -- Atlantic Impact Fund (demo)
  'd0000000-0000-4000-8000-000000000005',  -- Founders First Angels (demo)
  'f2a94a65-3489-4b50-827f-9d3b5b521322'   -- ablute_ — Internal QA
);
