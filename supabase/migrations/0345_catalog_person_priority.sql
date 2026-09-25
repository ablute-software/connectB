-- RECUPERADA de origin/claude/prompt-585-people-evidence-hooks (nunca fundida
-- em main), commit ff99a0a8cf5f4c6aeb163566c6e83040999e727b, 2026-09-10 (Prompt 737, Fase 0A). NÃO foi preciso
-- reconstruir por introspecção: o ficheiro original foi encontrado intacto
-- num branch remoto real que o git log --all por nome/conteúdo tinha
-- falhado em encontrar antes desta procura. Verificado objecto a objecto
-- contra produção em 2026-09-25 (enums, colunas, índices, políticas RLS,
-- triggers, funções, constraints) — zero diferenças confirmadas. O ledger
-- de produção já contém esta versão (supabase_migrations.schema_migrations);
-- NÃO aplicar de novo. Ver docs/parity_0344_0350_20260925.txt e
-- DECISIONS.md (Prompt 737).

-- NOTA SOBRE O SPLIT: o ledger de produção regista DUAS entradas separadas
-- começadas por "0345" (20260910155209 e 20260910155659, ~7,5 min de
-- diferença) mas só foi encontrado UM ficheiro-fonte no branch acima,
-- combinando ambas. Verificado por leitura directa que TODOS os objectos
-- (funções e a tabela catalog_person_priority) já existem em produção,
-- byte a byte iguais a este ficheiro combinado — nada está em falta. Este
-- ficheiro cobre a metade "topic_signal" (funções); o segundo ficheiro
-- 0345_catalog_person_priority.sql cobre a metade "person_priority"
-- (tabela + RLS + funções de recompute), dividido no ponto de secção
-- natural do ficheiro original, apenas para bater certo com as duas
-- entradas do ledger — não é uma reconstrução de conteúdo em falta.

-- ============================================================
-- catalog_person_priority — materialized ranking of who to contact
-- inside an already-eligible entity, per org (an org's own evidence
-- never counts for itself, so this genuinely varies by org).
--
-- Eligibility: seniority_rank <= 3 always; seniority_rank = 4 ONLY when
-- its own topic signal meets the interest threshold (Nuno's decision:
-- listed alongside <=3, not gated on their absence as the prompt's
-- original text said). Rank 9 and null never; do_not_contact never.
--
-- Order: a PROTECTED tier (seniority_rank <= 2) always sorts before
-- everyone else — Nuno's decision: rank 4 (or rank 3) may still outrank
-- ANOTHER rank-3/4 person on score, but never an eligible rank-1/2
-- person. Within each tier: score desc, seniority_rank asc, reachability
-- desc (linkedin_url present — the only real reachability signal that
-- exists on catalog_people today; platform_member_id/accepts_cold_contact
-- do not exist on this table, confirmed against the live schema, matching
-- Phase 3's own "reuse only what's real" decision), is_primary desc.
-- ============================================================
create table public.catalog_person_priority (
  org_id uuid not null references public.orgs(id) on delete cascade,
  person_id uuid not null references public.catalog_people(id) on delete cascade,
  entity_id uuid not null references public.catalog_entities(id) on delete cascade,
  rank_position int not null,
  score numeric not null default 0,
  components jsonb not null default '{}',
  justification text,
  inputs_hash text,
  computed_at timestamptz not null default now(),
  primary key (org_id, person_id, entity_id)
);

create index catalog_person_priority_org_entity_idx on public.catalog_person_priority (org_id, entity_id, rank_position);

alter table public.catalog_person_priority enable row level security;
create policy catalog_person_priority_read on public.catalog_person_priority for select
  using (is_platform_admin() or is_org_member(org_id));
create policy catalog_person_priority_admin_write on public.catalog_person_priority for all
  using (is_platform_admin()) with check (is_platform_admin());
revoke all on public.catalog_person_priority from anon, authenticated;
grant select on public.catalog_person_priority to authenticated;

-- Recomputes every eligible person's priority row for one (org, entity)
-- pair. Callable explicitly (admin action / future cron) — NOT wired to
-- fire automatically on evidence/org_topics/affiliation changes yet. That
-- live-trigger wiring is a disclosed, deliberate gap: this session's own
-- backfill (0344) already timed out once on a per-row trigger-style
-- recompute at ~4,987 rows, and wiring this onto every future evidence
-- insert risks the identical cascade at a worse multiplier (one evidence
-- row can affect many (org, entity) pairs at once via catalog_deliveries).
-- Recompute today is call-explicit; a follow-up prompt should design the
-- live-trigger path deliberately (e.g. a queued recompute, not synchronous)
-- rather than have it added here under time pressure.
create or replace function public.catalog_recompute_person_priority(p_org_id uuid, p_entity_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
begin
  delete from public.catalog_person_priority where org_id = p_org_id and entity_id = p_entity_id;

  with candidates as (
    select cpa.person_id, cpa.seniority_rank, cpa.is_primary,
      (cp.linkedin_url is not null) as reachable,
      public.catalog_topic_signal(p_org_id, cpa.person_id, null) as signal
    from public.catalog_person_affiliations cpa
    join public.catalog_people cp on cp.id = cpa.person_id
    where cpa.entity_id = p_entity_id and cpa.current and not cp.do_not_contact
      and cpa.seniority_rank is not null and cpa.seniority_rank < 9
  ),
  eligible as (
    select *,
      (signal->>'score')::numeric as score,
      coalesce((signal->>'meets_threshold')::boolean, false) as meets_threshold
    from candidates
    where seniority_rank <= 3 or coalesce((signal->>'meets_threshold')::boolean, false)
  ),
  ordered as (
    select *,
      row_number() over (
        order by (seniority_rank <= 2) desc, score desc, seniority_rank asc, reachable desc, is_primary desc
      ) as rank_position
    from eligible
  ),
  justified as (
    select o.*,
      (
        select string_agg(
          format('%s — %s', coalesce(t.label_en, 'This topic'), te->>'title'),
          '; ' order by (te->>'contribution')::numeric desc
        )
        from jsonb_array_elements(o.signal->'top_evidence') te
        left join public.topic_taxonomy t on t.id = (te->>'topic_id')::uuid
      ) as justification
    from ordered o
  )
  insert into public.catalog_person_priority (org_id, person_id, entity_id, rank_position, score, components, justification, inputs_hash, computed_at)
  select p_org_id, person_id, p_entity_id, rank_position, score, signal, justification,
    md5(p_org_id::text || '|' || p_entity_id::text || '|' || person_id::text || '|' || score::text), now()
  from justified;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.catalog_recompute_person_priority(uuid, uuid) from public, anon, authenticated;
grant execute on function public.catalog_recompute_person_priority(uuid, uuid) to service_role;

-- Bulk backfill entry point — every existing (org, entity) delivery pair.
create or replace function public.catalog_recompute_person_priority_backfill()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record; v_total int := 0; v_n int;
begin
  for r in select distinct org_id, catalog_id as entity_id from public.catalog_deliveries loop
    v_n := public.catalog_recompute_person_priority(r.org_id, r.entity_id);
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.catalog_recompute_person_priority_backfill() from public, anon, authenticated;
grant execute on function public.catalog_recompute_person_priority_backfill() to service_role;
