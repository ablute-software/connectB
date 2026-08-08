-- Prompt 137 — motor de enriquecimento de investidores (pessoas, hooks,
-- proveniencia). PROPOSTA, NAO APLICADA — mostrada a Nuno para confirmacao
-- antes de correr via apply_migration, por instrucao explicita do prompt e
-- da regra permanente deste projecto: a sessao revisora aplica, nao esta.
--
-- DESVIO 1 FACE AO PROMPT ORIGINAL, confirmado com o Nuno antes de escrever
-- esta migracao: o prompt assumia que as tabelas people / person_affiliations
-- / entity_enrichment_sources (0009, 0032) ja eram o modelo certo para isto.
-- Verificado em producao que NAO sao — o FK de people.entity_id e
-- person_affiliations.entity_id aponta para `entities` (o pipeline privado
-- por org, RLS is_org_member), nao para `catalog_entities` (o catalogo
-- partilhado de 537 investidores que este motor enriquece). Todas as 39
-- linhas de `people` hoje pertencem a um unico org_id (ablute_). Reusar essas
-- tabelas exigiria org_id nullable numa tabela cujo modelo de RLS inteiro
-- assenta em pertenca a org — dois modelos de acesso na mesma tabela, e uma
-- falha nesse ponto mostra a uma startup a investigacao privada de outra.
-- Por isso: tabelas novas, catalog_*, penduradas em catalog_entities. As
-- tabelas privadas people/person_affiliations/entity_enrichment_sources nao
-- sao tocadas.
--
-- DESVIO 2, decidido com o Nuno depois de rever a primeira proposta: dados
-- de pessoa nao sao dados de empresa. Espelhar cegamente a RLS de
-- catalog_entities (leitura publica quando verificado) exporia, a qualquer
-- visitante nao autenticado, biografias e ganchos de milhares de pessoas que
-- nunca deram consentimento a esta plataforma — problema de RGPD — e daria
-- de graca a um concorrente a base de investigacao que pagamos para
-- construir — problema comercial. Por isso a tabela de pessoa fica dividida
-- em duas:
--   catalog_people            — factos neutros (nome, linkedin_url,
--                                afiliacao primaria, hook_status, flags de
--                                compliance) — mesma regra do catalogo:
--                                legivel quando afiliado a entidade
--                                verificada, ou admin.
--   catalog_people_research   — material caro/sensivel (bio_raw, hook,
--                                intro_path, watch_outs, kill_words,
--                                background, email_guess) — legivel so por
--                                is_platform_admin() ou por um membro de uma
--                                org que tenha essa entidade na sua pipeline
--                                (catalog_deliveries, o ledger que ja existe
--                                para isto — 0002). do_not_contact e
--                                privacy_notice_sent ficam NEUTROS de
--                                proposito: sao travoes de seguranca, nao
--                                investigacao competitiva, e esconde-los
--                                atras do RLS sensivel arriscaria um
--                                outreach indevido por quem ainda nao
--                                desbloqueou a entidade.
--
-- Numeracao: o prompt sugeria 0145, mas esse numero ja esta ocupado
-- (0145_investor_entity_claims.sql, committed em main, ainda NAO aplicado a
-- producao — ultimo registo aplicado e 20260807111204). Esta migracao nao
-- depende de nenhum objecto criado pela 0145 (nao toca investor_entity_claims
-- nem matchdeal_investor_members.role) — pode ser aplicada antes ou depois
-- dela, mas quem aplica e sempre a sessao revisora, nunca esta sessao.
--
-- NAO TOCA em access_grants, matchdeal_eligible_deck, matchdeal_profiles,
-- nem nas tabelas privadas people/person_affiliations/entity_enrichment_sources.

-- ============================================================
-- 1. catalog_people — pessoa global, factos neutros.
-- ============================================================

create table public.catalog_people (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,

  linkedin_url text,
  linkedin_verified boolean not null default false,

  hook_status hook_status not null default 'to_research',

  -- Travoes de seguranca, deliberadamente NEUTROS (ver nota de topo) — visiveis
  -- sempre que a pessoa e visivel, independentemente de pipeline.
  do_not_contact boolean not null default false,
  privacy_notice_sent boolean not null default false,

  -- Conveniencia de leitura (fundo/entidade primaria), derivada de
  -- catalog_person_affiliations.is_primary — NUNCA a fonte de verdade (D3).
  -- Nullable: uma pessoa pode existir sem afiliacao corrente ainda resolvida.
  entity_id uuid references public.catalog_entities(id) on delete set null,

  enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'enriched', 'stale', 'failed')),
  enriched_at timestamptz,
  enrichment_stale_after timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- D9: nunca ler linkedin.com por robo — mas o URL guarda-se, e e a chave
-- unica da pessoa (D4). Normalizacao: minusculas, sem query string, sem
-- barra final, sem /details/... ou /overlay/.... IMMUTABLE para poder ser
-- usada numa generated column (exigido pelo Postgres).
create or replace function public.catalog_normalize_linkedin_url(url text)
returns text
language sql
immutable
as $$
  select case
    when url is null or btrim(url) = '' then null
    else regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(url)), '\?.*$', ''),
        '/(details|overlay)/.*$', ''
      ),
      '/+$', ''
    )
  end;
$$;

alter table public.catalog_people
  add column linkedin_url_normalized text
  generated always as (public.catalog_normalize_linkedin_url(linkedin_url)) stored;

create unique index catalog_people_linkedin_unique
  on public.catalog_people (linkedin_url_normalized)
  where linkedin_url_normalized is not null;

create index catalog_people_entity_idx on public.catalog_people (entity_id);
create index catalog_people_enrichment_status_idx on public.catalog_people (enrichment_status);

-- ============================================================
-- 2. catalog_people_research — material caro/sensivel, 1:1 com catalog_people.
-- ============================================================

create table public.catalog_people_research (
  person_id uuid primary key references public.catalog_people(id) on delete cascade,

  -- D1 (requisito mais importante do prompt): a biografia integral,
  -- verbatim, tal como extraida da pagina de equipa. Nenhum campo
  -- estruturado abaixo substitui isto — se a extraccao so puder guardar uma
  -- coisa, e esta.
  bio_raw text,

  hook text,
  intro_path text,
  watch_outs text,
  kill_words text[],
  background text,

  email_guess text,
  email_guess_confidence email_confidence,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 3. catalog_person_affiliations — o muitos-para-muitos (D3, D6). Neutro
-- (cargo, entidade, tipo) — mesma regra do catalogo.
-- ============================================================

create table public.catalog_person_affiliations (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid not null references public.catalog_people(id) on delete cascade,
  entity_id uuid not null references public.catalog_entities(id) on delete cascade,

  title text,
  kind affiliation_kind not null default 'other',
  is_primary boolean not null default false,
  current boolean not null default true,
  started_at date,
  ended_at date,
  seniority_rank int,
  notes text,

  created_at timestamptz not null default now(),

  unique (person_id, entity_id, kind)
);

create index catalog_person_affiliations_person_idx on public.catalog_person_affiliations (person_id);
create index catalog_person_affiliations_entity_idx on public.catalog_person_affiliations (entity_id);
-- D6: pontuar em alta quem tem mais do que uma afiliacao corrente — este
-- indice parcial e o que torna essa consulta barata.
create index catalog_person_affiliations_current_idx on public.catalog_person_affiliations (person_id) where current = true;

-- D5: aviso antes de contactar a mesma pessoa duas vezes via fundos
-- diferentes na mesma campanha. Vista consultavel — o aviso na interface
-- fica para depois, isto so expoe a informacao. So factos neutros, por isso
-- security_invoker e suficiente (a RLS de catalog_people/afiliacoes ja
-- decide quem ve cada linha).
create view public.catalog_people_multi_affiliated
  with (security_invoker = true) as
select
  cpa.person_id,
  cp.full_name,
  cp.linkedin_url,
  count(*) filter (where cpa.current) as current_affiliation_count,
  array_agg(distinct cpa.entity_id) filter (where cpa.current) as current_entity_ids
from public.catalog_person_affiliations cpa
join public.catalog_people cp on cp.id = cpa.person_id
group by cpa.person_id, cp.full_name, cp.linkedin_url
having count(*) filter (where cpa.current) > 1;

-- ============================================================
-- 4. catalog_entity_enrichment_sources — proveniencia (D8).
-- ============================================================

create table public.catalog_entity_enrichment_sources (
  id uuid primary key default uuid_generate_v4(),
  entity_id uuid not null references public.catalog_entities(id) on delete cascade,
  -- nullable: uma fonte pode suportar um facto ao nivel da entidade (tese,
  -- canal de submissao) sem ser sobre uma pessoa especifica.
  person_id uuid references public.catalog_people(id) on delete set null,

  source_url text not null,
  source_type text,
  published_at text,
  verified_at date,
  supports text,
  quality text,
  notes text,
  batch_id text not null,

  created_at timestamptz not null default now()
);

create index catalog_entity_enrichment_sources_entity_idx on public.catalog_entity_enrichment_sources (entity_id);
create index catalog_entity_enrichment_sources_person_idx on public.catalog_entity_enrichment_sources (person_id);
create index catalog_entity_enrichment_sources_batch_idx on public.catalog_entity_enrichment_sources (batch_id);

-- ============================================================
-- 5. enrichment_jobs — fila de trabalho do worker.
-- ============================================================

create table public.enrichment_jobs (
  id uuid primary key default uuid_generate_v4(),
  target_type text not null check (target_type in ('entity', 'person')),
  -- Polimorfico por desenho (aponta para catalog_entities.id ou
  -- catalog_people.id consoante target_type) — sem FK.
  target_id uuid not null,
  layer smallint not null check (layer in (1, 2)),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'skipped')),
  priority int not null default 100,
  requested_by_org_id uuid references public.orgs(id) on delete set null,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,

  -- Telemetria de custo — obrigatoria (secao 5 do prompt). O Nuno recalcula
  -- viabilidade economica com base nestes numeros; sem eles o teste final
  -- nao serve para nada.
  model text,
  tokens_in int,
  tokens_out int,
  web_calls int,
  cost_eur numeric(10, 5)
);

create unique index enrichment_jobs_one_active_per_target
  on public.enrichment_jobs (target_type, target_id, layer)
  where status in ('queued', 'running');

create index enrichment_jobs_queue_order_idx
  on public.enrichment_jobs (priority, created_at)
  where status = 'queued';
create index enrichment_jobs_created_at_idx on public.enrichment_jobs (created_at);

-- ============================================================
-- 6. Estado de enriquecimento em catalog_entities (aditivo).
-- ============================================================

alter table public.catalog_entities
  add column if not exists enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'enriched', 'stale', 'failed')),
  add column if not exists enriched_at timestamptz,
  add column if not exists enrichment_stale_after timestamptz;

create index if not exists catalog_entities_enrichment_status_idx on public.catalog_entities (enrichment_status);

-- ============================================================
-- 7. RLS.
-- ============================================================

alter table public.catalog_people enable row level security;
alter table public.catalog_people_research enable row level security;
alter table public.catalog_person_affiliations enable row level security;
alter table public.catalog_entity_enrichment_sources enable row level security;
alter table public.enrichment_jobs enable row level security;

-- catalog_people / catalog_person_affiliations: factos neutros, mesmo padrao
-- de catalog_entities (0002) — legivel quando afiliado a entidade verificada,
-- OU quando a entidade esta na pipeline de uma org do leitor (via
-- catalog_deliveries), ou admin.
--
-- O segundo ramo nao e opcional: medido em producao, 173 das 554 linhas de
-- catalog_deliveries (31%) apontam para entidades cujo verification_status
-- nao e 'verified' (entregas historicas, submissoes de utilizador ainda por
-- rever, etc.). Sem este ramo, uma org com uma dessas entidades na pipeline
-- veria a entidade mas nenhuma pessoa afiliada — e catalog_people_research
-- (que ja usa so catalog_deliveries, sem exigir verificado) ficaria a
-- conceder acesso a pessoas invisiveis em catalog_people. Confirmado por
-- medicao dentro de begin/rollback, nao so por leitura do plano de RLS.
create policy catalog_people_read on public.catalog_people for select
  using (
    is_platform_admin()
    or exists (
      select 1 from public.catalog_person_affiliations cpa
      join public.catalog_entities ce on ce.id = cpa.entity_id
      where cpa.person_id = catalog_people.id
        and ce.verification_status = 'verified'
    )
    or exists (
      select 1 from public.catalog_person_affiliations cpa2
      join public.catalog_deliveries cd on cd.catalog_id = cpa2.entity_id
      where cpa2.person_id = catalog_people.id
        and is_org_member(cd.org_id)
    )
  );
create policy catalog_people_admin_write on public.catalog_people for all
  using (is_platform_admin()) with check (is_platform_admin());

create policy catalog_person_affiliations_read on public.catalog_person_affiliations for select
  using (
    is_platform_admin()
    or exists (
      select 1 from public.catalog_entities ce
      where ce.id = catalog_person_affiliations.entity_id
        and ce.verification_status = 'verified'
    )
    or exists (
      select 1 from public.catalog_deliveries cd
      where cd.catalog_id = catalog_person_affiliations.entity_id
        and is_org_member(cd.org_id)
    )
  );
create policy catalog_person_affiliations_admin_write on public.catalog_person_affiliations for all
  using (is_platform_admin()) with check (is_platform_admin());

-- catalog_people_research: material caro/sensivel. Legivel so por admin ou
-- por um membro de uma org que tenha ALGUMA das entidades afiliadas desta
-- pessoa na sua pipeline — catalog_deliveries e o ledger que ja existe para
-- "esta entidade do catalogo foi entregue a este org" (0002, unique
-- (org_id, catalog_id)). Nao ha leitura publica desta tabela, verificado ou
-- nao — e exactamente o que a separacao de tabelas serve para evitar.
create policy catalog_people_research_read on public.catalog_people_research for select
  using (
    is_platform_admin()
    or exists (
      select 1 from public.catalog_person_affiliations cpa
      join public.catalog_deliveries cd on cd.catalog_id = cpa.entity_id
      where cpa.person_id = catalog_people_research.person_id
        and is_org_member(cd.org_id)
    )
  );
create policy catalog_people_research_admin_write on public.catalog_people_research for all
  using (is_platform_admin()) with check (is_platform_admin());

-- Proveniencia e metadado operacional (URLs de fontes, auto-avaliacao de
-- qualidade) — mesmo padrao admin-only que entity_enrichment_sources (0032)
-- ja usa.
create policy catalog_entity_enrichment_sources_admin_only on public.catalog_entity_enrichment_sources for all
  using (is_platform_admin()) with check (is_platform_admin());

-- Fila de trabalho: puramente operacional, admin-only. O worker (edge
-- function) usa a service role e bypassa RLS.
create policy enrichment_jobs_admin_only on public.enrichment_jobs for all
  using (is_platform_admin()) with check (is_platform_admin());
