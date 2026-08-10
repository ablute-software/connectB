-- Prompt 137 — motor de enriquecimento de investidores (pessoas, hooks,
-- proveniencia). Aplicada pela sessao revisora em 2026-08-08 apos revisao
-- integral do SQL, verificacao independente das dependencias e medicao das
-- contagens antes/depois. Texto identico ao do ramo
-- feature/investor-enrichment-engine, commit 61fc30a.
--
-- DESVIO 1: as tabelas people / person_affiliations / entity_enrichment_sources
-- NAO servem para isto — o FK aponta para `entities` (pipeline privado por
-- org, RLS is_org_member), nao para `catalog_entities`. Todas as 39 linhas de
-- `people` pertencem a um unico org (ablute_). Reusa-las exigiria org_id
-- nullable numa tabela cujo modelo de RLS assenta em pertenca a org — dois
-- modelos de acesso na mesma tabela, e uma falha mostra a uma startup a
-- investigacao privada de outra. Por isso: tabelas novas catalog_*. As
-- privadas nao sao tocadas.
--
-- DESVIO 2: dados de pessoa nao sao dados de empresa. A tabela de pessoa fica
-- dividida em catalog_people (factos neutros) e catalog_people_research
-- (bio_raw, hook, intro_path, watch_outs, kill_words, background,
-- email_guess) — esta ultima legivel so por admin ou por membro de org que
-- tenha a entidade na sua pipeline. do_not_contact e privacy_notice_sent
-- ficam neutros de proposito: sao travoes de seguranca, nao investigacao.
--
-- NAO TOCA em access_grants, matchdeal_eligible_deck, matchdeal_profiles,
-- nem nas tabelas privadas people/person_affiliations/entity_enrichment_sources.

create table public.catalog_people (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,

  linkedin_url text,
  linkedin_verified boolean not null default false,

  hook_status hook_status not null default 'to_research',

  do_not_contact boolean not null default false,
  privacy_notice_sent boolean not null default false,

  -- Conveniencia de leitura, derivada de catalog_person_affiliations.is_primary
  -- — NUNCA a fonte de verdade (D3).
  entity_id uuid references public.catalog_entities(id) on delete set null,

  enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'enriched', 'stale', 'failed')),
  enriched_at timestamptz,
  enrichment_stale_after timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- D4: chave unica da pessoa. IMMUTABLE para poder ser usada em generated column.
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

-- catalog_people_research — material caro/sensivel, 1:1 com catalog_people.
create table public.catalog_people_research (
  person_id uuid primary key references public.catalog_people(id) on delete cascade,

  -- D1 (requisito mais importante do prompt): a biografia integral, verbatim.
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

-- catalog_person_affiliations — o muitos-para-muitos (D3, D6).
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
create index catalog_person_affiliations_current_idx on public.catalog_person_affiliations (person_id) where current = true;

-- D5: aviso antes de contactar a mesma pessoa via fundos diferentes.
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

-- catalog_entity_enrichment_sources — proveniencia (D8).
create table public.catalog_entity_enrichment_sources (
  id uuid primary key default uuid_generate_v4(),
  entity_id uuid not null references public.catalog_entities(id) on delete cascade,
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

-- enrichment_jobs — fila de trabalho do worker.
create table public.enrichment_jobs (
  id uuid primary key default uuid_generate_v4(),
  target_type text not null check (target_type in ('entity', 'person')),
  -- Polimorfico por desenho — sem FK.
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

  -- Telemetria de custo — obrigatoria (secao 5 do prompt).
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

-- Estado de enriquecimento em catalog_entities (aditivo).
alter table public.catalog_entities
  add column if not exists enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'enriched', 'stale', 'failed')),
  add column if not exists enriched_at timestamptz,
  add column if not exists enrichment_stale_after timestamptz;

create index if not exists catalog_entities_enrichment_status_idx on public.catalog_entities (enrichment_status);

-- RLS.
alter table public.catalog_people enable row level security;
alter table public.catalog_people_research enable row level security;
alter table public.catalog_person_affiliations enable row level security;
alter table public.catalog_entity_enrichment_sources enable row level security;
alter table public.enrichment_jobs enable row level security;

-- O segundo ramo nao e opcional: medido em producao, 173 das 554 linhas de
-- catalog_deliveries (31%) apontam para entidades cujo verification_status
-- nao e 'verified'. Sem este ramo, uma org com uma dessas entidades na
-- pipeline veria a entidade mas nenhuma pessoa afiliada.
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

-- catalog_people_research: sem leitura publica, verificado ou nao.
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

create policy catalog_entity_enrichment_sources_admin_only on public.catalog_entity_enrichment_sources for all
  using (is_platform_admin()) with check (is_platform_admin());

create policy enrichment_jobs_admin_only on public.enrichment_jobs for all
  using (is_platform_admin()) with check (is_platform_admin());
