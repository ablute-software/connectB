-- Prompt 585 Phase 2 — the topic signal (SQL, zero AI) and the priority
-- ordering it feeds. Ships with no new UI beyond the entity-header block
-- wired in this same phase; the person evidence page itself is Phase 3.
--
-- Scope decision, made explicit here (Nuno, this session): §C.6 asks for
-- a new `topic_signal` component in a persisted `match_components jsonb`
-- structure. That structure does not exist — MATCHING_ENGINE_SPEC.md's
-- own §7 proposes it but its first line says "Nothing in this document
-- is implemented." The only live scoring is catalog_match_score(), a
-- plain int (0149_catalog_match_engine.sql). Building the full persisted-
-- components system as a prerequisite to this prompt would be a much
-- larger, unscoped undertaking. Nuno's decision: add the bonus directly
-- onto the live int (see catalog_topic_signal_match_bonus below), capped
-- at +8 as the prompt's own decision 5 proposes — additive, never
-- penalizes absence (zero evidence -> zero bonus, base score untouched).

-- ============================================================
-- catalog_topic_distance — 0 (same topic), 1 (direct parent/child),
-- 2 (grandparent/grandchild, or siblings sharing a parent), else null
-- (too far apart in the tree — ignored by the signal, never counted).
-- ============================================================
create or replace function public.catalog_topic_distance(p_a uuid, p_b uuid)
returns int language sql stable as $$
  select case
    when p_a = p_b then 0
    when exists (select 1 from public.topic_taxonomy where id = p_a and parent_id = p_b)
      or exists (select 1 from public.topic_taxonomy where id = p_b and parent_id = p_a) then 1
    when exists (
      select 1 from public.topic_taxonomy ta, public.topic_taxonomy tb
      where ta.id = p_a and tb.id = p_b and ta.parent_id is not null and ta.parent_id = tb.parent_id
    ) then 2
    when exists (
      select 1 from public.topic_taxonomy ta join public.topic_taxonomy tap on tap.id = ta.parent_id
      where ta.id = p_a and tap.parent_id = p_b
    ) then 2
    when exists (
      select 1 from public.topic_taxonomy tb join public.topic_taxonomy tbp on tbp.id = tb.parent_id
      where tb.id = p_b and tbp.parent_id = p_a
    ) then 2
    else null
  end;
$$;

revoke all on function public.catalog_topic_distance(uuid, uuid) from public;
grant execute on function public.catalog_topic_distance(uuid, uuid) to authenticated, service_role;

-- ============================================================
-- catalog_topic_signal(org, person|entity) — the signal itself.
-- Exactly one of p_person_id/p_entity_id is set: person mode scores a
-- specific person's own evidence; entity mode scores ONLY entity-linked
-- evidence (person_id is null) — rule 6's mirror at the engine level: an
-- entity's signal never borrows a person's personal evidence as if the
-- entity itself said it.
--
-- Eligible evidence: status in ('found','verified'), url not null
-- (enforced by the table's own constraint already), NOT contributed by
-- the requesting org itself (an org's own proposed evidence never scores
-- for that org — rule 7), polarity <> 'negative'.
--
-- Per matching tag: distance-weighted, recency-weighted, strength- and
-- confidence-weighted contribution; capped per topic at 4 (one
-- strength-4, same-topic, recent match's worth), capped globally at 20
-- internal points, before catalog_topic_signal_match_bonus maps that
-- onto the entity match score's own +0..+8 scale.
--
-- Threshold (rule 2): score reads as 0 ("mention", not "interest") unless
-- >= 2 distinct evidence urls contributed, OR one did with strength = 4.
--
-- Contra-indications (rule 3): a negative-polarity evidence row tagged
-- within distance <= 1 of an org topic becomes a watch_out entry — listed,
-- never subtracted from the score.
create or replace function public.catalog_topic_signal(p_org_id uuid, p_person_id uuid default null, p_entity_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' and not (is_org_member(p_org_id) or is_platform_admin()) then
    raise exception 'not authorized';
  end if;
  if (p_person_id is null) = (p_entity_id is null) then
    raise exception 'catalog_topic_signal: exactly one of p_person_id/p_entity_id must be set';
  end if;

  with eligible_evidence as (
    select ce.* from public.catalog_evidence ce
    where (p_person_id is not null and ce.person_id = p_person_id)
       or (p_entity_id is not null and ce.entity_id = p_entity_id and ce.person_id is null)
  ),
  contributing as (
    select ee.id as evidence_id, ee.url, ee.title, ee.excerpt,
      coalesce(ee.published_at, ee.created_at::date) as effective_date,
      cet.topic_id as evidence_topic_id, cet.confidence,
      ot.topic_id as org_topic_id, ee.strength,
      public.catalog_topic_distance(cet.topic_id, ot.topic_id) as dist
    from eligible_evidence ee
    join public.catalog_evidence_topics cet on cet.evidence_id = ee.id
    join public.org_topics ot on ot.org_id = p_org_id
    where ee.status in ('found', 'verified')
      and (ee.created_by_org_id is null or ee.created_by_org_id <> p_org_id)
      and ee.polarity <> 'negative'
      and public.catalog_topic_distance(cet.topic_id, ot.topic_id) is not null
  ),
  scored as (
    select *,
      strength
        * (case when effective_date >= (now() - interval '12 months')::date then 1.0
                when effective_date >= (now() - interval '36 months')::date then 0.7
                else 0.4 end)
        * (case dist when 0 then 1.0 when 1 then 0.6 else 0.3 end)
        * coalesce(confidence, 1.0) as contribution
    from contributing
  ),
  per_topic as (
    select org_topic_id, least(4.0, sum(contribution)) as topic_score
    from scored
    group by org_topic_id
  ),
  raw as (
    select least(20.0, coalesce(sum(topic_score), 0)) as raw_score from per_topic
  ),
  threshold as (
    select count(distinct evidence_id) as n_evidence, coalesce(bool_or(strength = 4), false) as has_strength4
    from scored
  ),
  watch_outs as (
    select coalesce(jsonb_agg(distinct jsonb_build_object('topic_id', evidence_topic_id, 'evidence_id', evidence_id, 'title', title, 'url', url)), '[]'::jsonb) as v
    from (
      select ee.id as evidence_id, ee.title, ee.url, cet.topic_id as evidence_topic_id
      from eligible_evidence ee
      join public.catalog_evidence_topics cet on cet.evidence_id = ee.id
      join public.org_topics ot on ot.org_id = p_org_id
      where ee.status in ('found', 'verified') and ee.polarity = 'negative'
        and public.catalog_topic_distance(cet.topic_id, ot.topic_id) between 0 and 1
    ) w
  ),
  top_evidence as (
    select coalesce(jsonb_agg(x), '[]'::jsonb) as v from (
      select jsonb_build_object('evidence_id', evidence_id, 'title', title, 'url', url, 'topic_id', org_topic_id, 'contribution', round(contribution::numeric, 2)) as x
      from scored order by contribution desc limit 3
    ) y
  )
  select jsonb_build_object(
    'score', (select raw_score from raw),
    'meets_threshold', (select (n_evidence >= 2 or has_strength4) from threshold),
    'watch_outs', (select v from watch_outs),
    'top_evidence', (select v from top_evidence)
  ) into v_result;

  if not coalesce((v_result->>'meets_threshold')::boolean, false) then
    v_result := jsonb_set(v_result, '{score}', '0');
  end if;

  return v_result;
end;
$$;

revoke all on function public.catalog_topic_signal(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.catalog_topic_signal(uuid, uuid, uuid) to authenticated, service_role;

-- Maps the internal 0-20 raw score onto the entity match score's own
-- +0..+8 additive bonus (decision 5's own number). Linear, capped.
create or replace function public.catalog_topic_signal_match_bonus(p_raw_score numeric)
returns int language sql immutable as $$
  select least(8, floor(greatest(0, coalesce(p_raw_score, 0)) * 8.0 / 20))::int;
$$;

revoke all on function public.catalog_topic_signal_match_bonus(numeric) from public;
grant execute on function public.catalog_topic_signal_match_bonus(numeric) to authenticated, service_role;

-- ============================================================
-- catalog_match_score — extended with the topic_signal bonus. Every
-- original line is unchanged; only the new declare vars and the bonus
-- computation before `return v_score` are added.
-- ============================================================
create or replace function public.catalog_match_score(p_org_id uuid, p_catalog_id uuid)
returns integer
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_org record; v_cat record; v_score int := 0;
  v_rank_org int; v_rank_min int; v_rank_max int; v_lo int; v_hi int; v_dist int;
  v_ticket numeric; v_cc text; v_ec text;
  v_entity_signal jsonb; v_best_person_signal numeric := 0; v_bonus int := 0;
begin
  if auth.role() is distinct from 'service_role' and not (is_org_member(p_org_id) or is_platform_admin()) then
    raise exception 'not authorized';
  end if;
  select sectors, stage, round_min_ticket_eur, round_target_eur, country into v_org from public.orgs where id = p_org_id;
  if not found then return null; end if;
  select sectors_normalized, stage_min, stage_max, check_min_eur, check_max_eur, hq_country, verification_status
    into v_cat from public.catalog_entities where id = p_catalog_id;
  if not found or v_cat.verification_status <> 'verified' then return null; end if;

  if coalesce(array_length(v_cat.sectors_normalized,1),0) = 0 then v_score := v_score + 15;
  elsif v_cat.sectors_normalized && v_org.sectors then v_score := v_score + 35; end if;

  v_rank_org := case v_org.stage when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6 else null end;
  v_rank_min := case v_cat.stage_min when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6 else null end;
  v_rank_max := case v_cat.stage_max when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6 else null end;
  if v_cat.stage_min is null and v_cat.stage_max is null then v_score := v_score + 12;
  elsif v_org.stage = 'other' or v_cat.stage_min = 'other' or v_cat.stage_max = 'other' then v_score := v_score + 12;
  elsif v_rank_org is null then v_score := v_score + 12;
  else
    v_lo := coalesce(v_rank_min,1); v_hi := coalesce(v_rank_max,6);
    if v_rank_org between v_lo and v_hi then v_score := v_score + 25;
    else v_dist := least(abs(v_rank_org-v_lo), abs(v_rank_org-v_hi));
      if v_dist = 1 then v_score := v_score + 10; end if; end if;
  end if;

  v_ticket := coalesce(v_org.round_min_ticket_eur, v_org.round_target_eur);
  if v_ticket is null or v_cat.check_min_eur is null or v_cat.check_max_eur is null then v_score := v_score + 10;
  elsif v_ticket between v_cat.check_min_eur and v_cat.check_max_eur then v_score := v_score + 20;
  elsif (v_ticket < v_cat.check_min_eur and v_ticket*2 >= v_cat.check_min_eur)
     or (v_ticket > v_cat.check_max_eur and v_ticket <= v_cat.check_max_eur*2) then v_score := v_score + 10; end if;

  v_cc := public.normalize_country_code(v_org.country);
  v_ec := public.normalize_country_code(v_cat.hq_country);
  if v_ec is not null and v_cc is not null and v_ec = v_cc then v_score := v_score + 10;
  elsif v_ec in ('GB','DE','FR','NL','CH','SE') then v_score := v_score + 6;
  elsif v_ec in ('DK','FI','NO','IE','BE','AT','IT','ES','PL','LU','GR','CZ','HU','RO','BG','HR','SI','SK','EE','LV','LT','IS','MT','CY') then v_score := v_score + 4;
  else v_score := v_score + 2; end if;

  -- Prompt 585 Phase 2 — topic_signal bonus. max(entity's own signal, best
  -- eligible/reachable person's signal). Eligible here mirrors
  -- catalog_person_priority's own gate (seniority_rank <= 4, current,
  -- not do_not_contact) rather than duplicating a narrower one.
  v_entity_signal := public.catalog_topic_signal(p_org_id, null, p_catalog_id);
  -- max(), not a bare `greatest()` fed by an unordered multi-row SELECT
  -- INTO: without STRICT, PL/pgSQL's SELECT INTO silently keeps only
  -- whichever row the planner returns first when a query yields more than
  -- one — confirmed empirically against a zz-test fixture with 3 eligible
  -- people (one real signal, two zero): the bonus came out 0 instead of
  -- the expected +1 because greatest() only ever saw a single arbitrary
  -- row, not all of them. An actual aggregate fixes it.
  select coalesce(max((public.catalog_topic_signal(p_org_id, cpa.person_id, null)->>'score')::numeric), 0)
    into v_best_person_signal
  from public.catalog_person_affiliations cpa
  join public.catalog_people cp on cp.id = cpa.person_id
  where cpa.entity_id = p_catalog_id and cpa.current and not cp.do_not_contact
    and cpa.seniority_rank is not null and cpa.seniority_rank <= 4;
  v_bonus := public.catalog_topic_signal_match_bonus(greatest(coalesce((v_entity_signal->>'score')::numeric, 0), v_best_person_signal));
  v_score := v_score + v_bonus;

  return v_score;
end;
$function$;

revoke all on function public.catalog_match_score(uuid, uuid) from public, anon;
grant execute on function public.catalog_match_score(uuid, uuid) to authenticated, service_role;

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
