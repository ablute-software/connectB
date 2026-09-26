-- RECUPERADA por introspecção directa de produção (supabase_migrations.schema_migrations.statements),
-- 2026-09-26 (Prompt 737, sessão diferente da autora). Aplicada às 17:20 UTC
-- por uma sessão a trabalhar no "Passo 3" do dossier de pessoa (importação do
-- showcase da Portugal Ventures), sem permissão de git push — nunca chegou a
-- um branch até agora. Ver schema_final_v2_revisto_passo3_20260926.md (pasta
-- do Nuno) para o desenho completo, incluindo a matriz de testes e o diff
-- face à ronda anterior. NÃO reconstruída além da introspecção — o texto
-- abaixo é exactamente o que produção tem gravado, e confere com o DDL
-- "corrigido" desse documento (3 valores de evidence_kind, constraint
-- bidireccional, índice com entity_id) — não com uma versão anterior/rascunho.
--
-- Passo 3 do plano do dossier de pessoa (26/09/2026), parte 2/2.
-- Depende dos valores de evidence_kind já existirem (parte 1).

-- 2) relation_kind em catalog_evidence_topics
create type evidence_topic_relation as enum (
  'direct_statement', 'professional_experience', 'indirect_responsibility'
);
alter table catalog_evidence_topics
  add column relation_kind evidence_topic_relation null;

-- 3) role_type — obrigatório para kind='role_history', proibido nos restantes
create type role_type_kind as enum ('employment', 'board_advisory');
alter table catalog_evidence
  add column role_type role_type_kind null;

-- 4) datas estruturadas, precisão por extremo (bidirecional), estado "actual" tri-state
create type date_precision as enum ('exact_day', 'month', 'year', 'approximate');
alter table catalog_evidence
  add column period_from date null,
  add column period_from_precision date_precision null,
  add column period_to date null,
  add column period_to_precision date_precision null,
  add column period_is_current boolean null;

alter table catalog_evidence
  add constraint catalog_evidence_role_type_required_for_role_history
    check ((kind = 'role_history') = (role_type is not null)),
  add constraint catalog_evidence_period_current_no_end
    check (period_is_current is not true or period_to is null),
  add constraint catalog_evidence_period_end_implies_not_current
    check (period_to is null or period_is_current is false),
  add constraint catalog_evidence_period_from_precision_pair
    check ((period_from is null) = (period_from_precision is null)),
  add constraint catalog_evidence_period_to_precision_pair
    check ((period_to is null) = (period_to_precision is null));

-- 5) catalog_person_research_log
create type research_scope as enum (
  'career', 'education', 'board_seats', 'statements', 'interviews',
  'articles', 'podcasts', 'events', 'topics', 'portfolio', 'personal_signals'
);
create type research_result as enum ('found', 'not_found', 'not_public');
create type research_performed_by_kind as enum ('system', 'admin_user');

create table catalog_person_research_log (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references catalog_people(id) on delete cascade,
  entity_id uuid null references catalog_entities(id) on delete set null,
  scope research_scope not null,
  searched_at timestamptz not null default now(),
  result research_result not null,
  sources_checked jsonb not null default '[]',
  performed_by_kind research_performed_by_kind not null,
  performed_by_user_id uuid null references auth.users(id) on delete set null,
  requested_by_org_id uuid null references orgs(id) on delete set null,
  notes text null,
  created_at timestamptz not null default now(),
  constraint catalog_person_research_log_performed_by_check check (
    (performed_by_kind = 'system'      and performed_by_user_id is null) or
    (performed_by_kind = 'admin_user'  and performed_by_user_id is not null)
  ),
  constraint catalog_person_research_log_sources_is_array
    check (jsonb_typeof(sources_checked) = 'array'),
  constraint catalog_person_research_log_sources_required
    check (result = 'found' or jsonb_array_length(sources_checked) > 0)
);

create index catalog_person_research_log_lookup
  on catalog_person_research_log (person_id, entity_id, scope, searched_at desc);

-- RLS + grants
alter table catalog_person_research_log enable row level security;

revoke all on catalog_person_research_log from anon, authenticated;

create policy catalog_person_research_log_read
  on catalog_person_research_log
  for select
  using (
    is_platform_admin()
    or (
      entity_id is not null
      and exists (
        select 1 from catalog_deliveries cd
        where cd.catalog_id = catalog_person_research_log.entity_id
          and is_org_member(cd.org_id)
      )
    )
  );

grant select on catalog_person_research_log to authenticated;
