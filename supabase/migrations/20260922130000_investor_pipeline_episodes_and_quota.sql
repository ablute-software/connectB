-- Prompt 715 (Fase 1 do "pipeline que aprende") — PROPOSED, NOT applied to
-- production. Numbered by real UTC timestamp at write time; checked against
-- both the local ledger and every remote branch's own migrations directory
-- before choosing it (`20260922111731_catalog_entities_extra_facts.sql` was
-- the latest found anywhere, on `main` or an open branch).
--
-- This is the "does not learn, does not reorder" foundation Pedido A asks
-- for: an append-only signal ledger (investor_signal_events) grouped into
-- one row per live relationship (investor_opportunity_episodes), a
-- mandate-version snapshot so a later mandate change never mixes with
-- earlier history (Pedido D), a per-firm "current context" card (Pedido C),
-- and the reserve/consume columns + functions the quota rewrite (Pedido G)
-- needs. Nothing here touches computeMatchScore (Prompt 714), computeAdmissions,
-- buildPipelineWaves or matchdeal_eligible_deck's own logic — only new
-- columns/tables and two new SECURITY DEFINER functions.

-- ============================================================
-- Pedido D — mandate + context version snapshots (created first: episodes
-- and events both reference investor_mandate_versions.id)
-- ============================================================
create table if not exists investor_mandate_versions (
  id uuid primary key default gen_random_uuid(),
  investor_catalog_entity_id uuid not null references catalog_entities(id) on delete cascade,
  version_no integer not null,
  -- The About form's declared thesis (sectors, stages, geographies,
  -- instruments, ticket, exclusions) AND the context card's own fields at
  -- the moment this version was cut — one snapshot, not two tables to
  -- join back in time later.
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (investor_catalog_entity_id, version_no)
);
create index if not exists investor_mandate_versions_entity_idx on investor_mandate_versions (investor_catalog_entity_id, version_no desc);

alter table investor_mandate_versions enable row level security;
-- Investor-private history; no founder-facing reason to read it. Same
-- posture as investor_watch_thresholds — service-role only, no policy.

-- ============================================================
-- Pedido C — "Current context" card. One row per firm.
-- ============================================================
create table if not exists investor_context (
  id uuid primary key default gen_random_uuid(),
  investor_catalog_entity_id uuid not null unique references catalog_entities(id) on delete cascade,
  priority_note text check (priority_note is null or char_length(priority_note) <= 280),
  pause_new_candidates boolean not null default false,
  -- Optional; registered for fase 4, has no scoring effect in this phase.
  capacity text check (capacity is null or capacity in ('few', 'normal', 'many')),
  -- "válido até" and "rever em" are the SAME mechanism (a date past which
  -- the card stops having effect) with two different button labels on the
  -- same field, per the prompt's own "ou" — not two independent dates.
  expires_at timestamptz,
  expiry_label text check (expiry_label is null or expiry_label in ('valid_until', 'review_by')),
  -- The platform's own one-shot nudge ("3x 'no capacity' chips in 30 days")
  -- — when the investor dismisses it, no repeat for 60 days. Never set by
  -- anything other than that suggestion flow.
  suggestion_dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table investor_context enable row level security;
-- Same posture as investor_mandate_versions: investor-private, service-role only.

-- Pedido C, last bullet — capital_to_deploy_eur (matchdeal_profiles,
-- migration 0056) gains a confirmation timestamp; 90 days stale shows
-- "por confirmar" in the About panel. Nullable, never backfilled — an
-- existing value isn't retroactively "confirmed" by this migration.
alter table matchdeal_profiles add column if not exists capital_to_deploy_confirmed_at timestamptz;

-- ============================================================
-- Pedido A — one episode per (firm, org) live relationship
-- ============================================================
create table if not exists investor_opportunity_episodes (
  id uuid primary key default gen_random_uuid(),
  investor_catalog_entity_id uuid not null references catalog_entities(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text,
  -- A reopen (Pedido A: "reabrir continua o mesmo episódio") never sets
  -- this — it just clears closed_at on the SAME row. Only a genuinely new
  -- episode opened because of a material change (new round, stage change)
  -- points back at the one it supersedes.
  related_episode_id uuid references investor_opportunity_episodes(id),
  mandate_version_id uuid references investor_mandate_versions(id),
  -- Marked once at creation from catalog_entities.is_test OR any active
  -- matchdeal_investor_members.is_internal for this firm — named
  -- explicitly (not just "is_test") per this codebase's own documented
  -- lesson that the two are different exemptions that must both be
  -- checked (is_test_vs_is_internal_org_counts).
  is_test_or_internal boolean not null default false,
  created_at timestamptz not null default now()
);
-- One OPEN episode per (firm, org) — a reopen updates this same row
-- (closed_at back to null), it never inserts a second one.
create unique index if not exists investor_opportunity_episodes_open_idx
  on investor_opportunity_episodes (investor_catalog_entity_id, org_id) where closed_at is null;
create index if not exists investor_opportunity_episodes_entity_idx on investor_opportunity_episodes (investor_catalog_entity_id);
create index if not exists investor_opportunity_episodes_org_idx on investor_opportunity_episodes (org_id);

alter table investor_opportunity_episodes enable row level security;
-- Investor-private analytics substrate — no founder/investor client ever
-- reads this table directly today; service-role only, no policy, same as
-- investor_pipeline_admissions (0157).

-- ============================================================
-- Pedido A — the append-only signal ledger
-- ============================================================
create table if not exists investor_signal_events (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references investor_opportunity_episodes(id) on delete cascade,
  -- Null for a system-generated event (a wave presentation, a card marked
  -- unavailable by a founder-side change) — "quem agiu" only applies when
  -- someone did.
  actor_user_id uuid references auth.users(id),
  -- Reserved for when per-seat roles exist (Pedido A's own "papéis... para
  -- depois"); every decision today counts as the firm's, per Nuno's 22/09
  -- call, so this stays null until that later phase gives it a value.
  actor_role text,
  level text not null check (level in ('envolvimento', 'avaliacao_substantiva', 'progressao', 'decisao', 'condicao', 'contexto', 'sistema')),
  kind text not null,
  source_table text,
  source_id uuid,
  -- Unique when present; deliberately nullable (most 'envolvimento'-level
  -- events — card_opened, tool_opened — have nothing to deduplicate
  -- against, only the multiply-written decision/archive/swipe act does).
  dedup_key text,
  private_reason_chips text[] not null default '{}',
  private_note text check (private_note is null or char_length(private_note) <= 2000),
  -- Prompt 715 §3 — the last three chips (sem_capacidade_agora,
  -- ja_conhecia, and — once fase 3 exists — a competitor-in-portfolio
  -- pass) are marked not_startup_fault at the SOURCE, in code
  -- (NOT_STARTUP_FAULT_CHIPS, investor-signal-chips.ts), not by a column
  -- here: it is a property of the CHIP, derivable from private_reason_chips
  -- whenever it's read, so a future new chip can't silently need a second
  -- place to be marked.
  snapshot jsonb,
  mandate_version_id uuid references investor_mandate_versions(id),
  is_test_or_internal boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists investor_signal_events_dedup_idx on investor_signal_events (dedup_key) where dedup_key is not null;
create index if not exists investor_signal_events_episode_idx on investor_signal_events (episode_id, created_at);
create index if not exists investor_signal_events_kind_idx on investor_signal_events (kind);

alter table investor_signal_events enable row level security;
-- Never founder-readable (private_reason_chips/private_note MUST NOT reach
-- an org-member policy) and never investor-client-readable either — this is
-- an internal ledger, written and read only by service-role code.

comment on table investor_signal_events is
  'Append-only. Never delete or update a row to "correct" it — write a new event instead. private_reason_chips/private_note must never be exposed to any founder-facing route or export.';

-- ============================================================
-- Pedido G — reserve/consume columns on the existing admissions table
-- ============================================================
alter table investor_pipeline_admissions add column if not exists reserved_at timestamptz;
alter table investor_pipeline_admissions add column if not exists presented_at timestamptz;
alter table investor_pipeline_admissions add column if not exists substituted_by_org_id uuid references orgs(id);
alter table investor_pipeline_admissions add column if not exists substitutes_org_id uuid references orgs(id);
create index if not exists investor_pipeline_admissions_presented_idx on investor_pipeline_admissions (investor_catalog_entity_id, presented_at);

-- Backfill: every existing admission becomes both reserved and presented at
-- its own admitted_at. Pedido G's own fallback for "se não for possível
-- saber [se estava numa wave desbloqueada]" — there is no historical wave-
-- unlock log to check against, so this is not an approximation of a lost
-- signal, it is the documented default.
update investor_pipeline_admissions
  set reserved_at = coalesce(reserved_at, admitted_at), presented_at = coalesce(presented_at, admitted_at)
  where reserved_at is null or presented_at is null;

comment on column investor_pipeline_admissions.reserved_at is
  'A lugar was set aside for this candidate. Set atomically by reserve_pipeline_admissions().';
comment on column investor_pipeline_admissions.presented_at is
  'First time this candidate was actually returned inside an UNLOCKED wave to any user of the firm. This, not reserved_at or admitted_at, is what counts against the monthly quota ("N of M presented this month").';

-- ============================================================
-- Pedido G — atomic reserve, atomic consume, atomic substitute
-- ============================================================

-- Reserves as many of p_org_ids (already ranked best-first by the caller)
-- as this month's remaining budget allows, in order, skipping any that are
-- already reserved (permanent — never re-spends budget). Budget is
-- computed from PRESENTED_AT this month, not reserved_at or admitted_at
-- (Pedido G: "quota do mês = lugares consumidos... não reservas") — a
-- reservation that is never presented does not itself cost anything,
-- which is what keeps "reserve only what the next wave needs" from ever
-- silently starving a later, better-ranked candidate.
--
-- pg_advisory_xact_lock keyed by the firm: two concurrent callers for the
-- same firm serialize here, so neither can observe a stale budget and both
-- overshoot the cap (AP-14-style race, same technique as
-- decide_investor_relationship's unique-constraint race but here the
-- resource is a COUNT, not a single row, so the lock is what's actually
-- needed instead of ON CONFLICT).
create or replace function public.reserve_pipeline_admissions(
  p_investor_catalog_entity_id uuid, p_org_ids uuid[], p_monthly_cap integer, p_month_start timestamptz
) returns table(org_id uuid, reserved boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_lock_key bigint := hashtextextended(p_investor_catalog_entity_id::text, 0);
  v_used_this_month integer;
  v_budget integer;
  v_org uuid;
  v_already_reserved boolean;
begin
  perform pg_advisory_xact_lock(v_lock_key);

  select count(*) into v_used_this_month from investor_pipeline_admissions a
    where a.investor_catalog_entity_id = p_investor_catalog_entity_id and a.presented_at >= p_month_start;
  v_budget := greatest(0, p_monthly_cap - v_used_this_month);

  foreach v_org in array p_org_ids loop
    select exists(
      select 1 from investor_pipeline_admissions a
        where a.investor_catalog_entity_id = p_investor_catalog_entity_id and a.org_id = v_org
    ) into v_already_reserved;

    if v_already_reserved then
      org_id := v_org; reserved := true; return next;
      continue;
    end if;

    if v_budget <= 0 then
      org_id := v_org; reserved := false; return next;
      continue;
    end if;

    -- ON CONFLICT ON CONSTRAINT, not a bare (investor_catalog_entity_id,
    -- org_id) column list: this function's own OUT parameter is ALSO named
    -- org_id (the RETURNS TABLE contract callers depend on), and plpgsql
    -- resolves a bare column list against variables first — confirmed the
    -- hard way, a live rollback-transaction call raised "column reference
    -- org_id is ambiguous" that CREATE OR REPLACE FUNCTION itself never
    -- caught (Postgres doesn't fully validate a function body's SQL until
    -- it actually runs). Naming the constraint sidesteps the collision
    -- instead of renaming the OUT parameter and breaking the API contract.
    insert into investor_pipeline_admissions (investor_catalog_entity_id, org_id, admitted_at, reserved_at)
      values (p_investor_catalog_entity_id, v_org, now(), now())
      on conflict on constraint investor_pipeline_admissions_investor_catalog_entity_id_org_key do nothing;
    v_budget := v_budget - 1;
    org_id := v_org; reserved := true; return next;
  end loop;
  return;
end; $$;

revoke execute on function public.reserve_pipeline_admissions(uuid, uuid[], integer, timestamptz) from public, anon, authenticated;

-- Consume: the FIRST time a reserved org_id is actually inside an unlocked
-- wave returned to a browser, of any user at the firm. No lock needed — an
-- UPDATE guarded by "presented_at is null" is naturally idempotent under
-- concurrency (two racing calls both set it to ~now(); which one wins by a
-- few milliseconds is immaterial, unlike the budget count above).
create or replace function public.mark_pipeline_presented(
  p_investor_catalog_entity_id uuid, p_org_ids uuid[]
) returns void
language sql security definer set search_path = public as $$
  update investor_pipeline_admissions
    set presented_at = now()
    where investor_catalog_entity_id = p_investor_catalog_entity_id
      and org_id = any(p_org_ids)
      and presented_at is null;
$$;

revoke execute on function public.mark_pipeline_presented(uuid, uuid[]) from public, anon, authenticated;

-- Substitute: before a reservation is ever presented, swap it for a
-- different org (a better-ranked candidate arrived, or the reserved one
-- stopped being eligible/in-mandate). "A reserva mantém-se — é o mesmo
-- lugar": no budget is spent or freed by this call, it only relabels which
-- org occupies an already-reserved, not-yet-presented slot. Refuses once
-- the old slot has been presented — at that point it is consumed history,
-- not a reservation to move.
create or replace function public.substitute_pipeline_reservation(
  p_investor_catalog_entity_id uuid, p_old_org_id uuid, p_new_org_id uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_lock_key bigint := hashtextextended(p_investor_catalog_entity_id::text, 0);
  v_old investor_pipeline_admissions;
begin
  perform pg_advisory_xact_lock(v_lock_key);

  select * into v_old from investor_pipeline_admissions
    where investor_catalog_entity_id = p_investor_catalog_entity_id and org_id = p_old_org_id;
  if v_old.id is null or v_old.presented_at is not null then
    return false;
  end if;

  update investor_pipeline_admissions set substituted_by_org_id = p_new_org_id where id = v_old.id;
  insert into investor_pipeline_admissions (investor_catalog_entity_id, org_id, admitted_at, reserved_at, substitutes_org_id)
    values (p_investor_catalog_entity_id, p_new_org_id, now(), now(), p_old_org_id)
    on conflict (investor_catalog_entity_id, org_id) do update set substitutes_org_id = excluded.substitutes_org_id;
  return true;
end; $$;

revoke execute on function public.substitute_pipeline_reservation(uuid, uuid, uuid) from public, anon, authenticated;

-- ============================================================
-- Backfill — episodes + events from existing history, deduplicated.
-- Volume is expected to be a few dozen rows platform-wide (the study's own
-- count: 7 decisions, 6 swipes) — a few DO blocks, not a batch job.
-- ============================================================
do $$
declare
  v_test_entities uuid[];
  v_internal_entities uuid[];
begin
  select array_agg(id) into v_test_entities from catalog_entities where is_test;
  select array_agg(distinct catalog_entity_id) into v_internal_entities from matchdeal_investor_members where is_internal;

  -- 1) investor_relationship_decisions is the primary source: one episode
  -- (opened at decided_at, or earlier if a watch/followup/swipe predates
  -- it) and exactly one 'decisao' event per row.
  insert into investor_opportunity_episodes (investor_catalog_entity_id, org_id, opened_at, is_test_or_internal)
  select d.investor_catalog_entity_id, d.org_id, d.decided_at,
    coalesce(d.investor_catalog_entity_id = any(v_test_entities), false) or coalesce(d.investor_catalog_entity_id = any(v_internal_entities), false)
  from investor_relationship_decisions d
  on conflict (investor_catalog_entity_id, org_id) where closed_at is null do nothing;

  insert into investor_signal_events (episode_id, actor_user_id, level, kind, source_table, source_id, dedup_key, is_test_or_internal, created_at)
  select e.id, d.decided_by, 'decisao', d.decision, 'investor_relationship_decisions', d.id,
    d.investor_catalog_entity_id::text || ':' || d.org_id::text || ':decisao:' || d.id::text,
    e.is_test_or_internal, d.decided_at
  from investor_relationship_decisions d
  join investor_opportunity_episodes e on e.investor_catalog_entity_id = d.investor_catalog_entity_id and e.org_id = d.org_id and e.closed_at is null
  on conflict (dedup_key) where dedup_key is not null do nothing;

  -- 2) matchdeal_swipes: only the ones NOT already covered by a decision
  -- for the same (firm, org) within the same minute (Pedido A's exact
  -- dedup rule) — a genuine deck-only swipe still gets its own episode +
  -- event.
  insert into investor_opportunity_episodes (investor_catalog_entity_id, org_id, opened_at, is_test_or_internal)
  select distinct m.catalog_entity_id, so.membership_id, s.created_at,
    coalesce(m.catalog_entity_id = any(v_test_entities), false) or coalesce(m.catalog_entity_id = any(v_internal_entities), false)
  from matchdeal_swipes s
  join matchdeal_profiles ap on ap.id = s.actor_profile_id and ap.kind = 'investor'
  join matchdeal_investor_members m on m.id = ap.membership_id
  join matchdeal_profiles so on so.id = s.target_profile_id and so.kind = 'startup'
  where not exists (
    select 1 from investor_relationship_decisions d
    where d.investor_catalog_entity_id = m.catalog_entity_id and d.org_id = so.membership_id
      and date_trunc('minute', d.decided_at) = date_trunc('minute', s.created_at)
  )
  on conflict (investor_catalog_entity_id, org_id) where closed_at is null do nothing;

  insert into investor_signal_events (episode_id, level, kind, source_table, source_id, dedup_key, is_test_or_internal, created_at)
  select e.id, 'decisao', case s.direction when 'pass' then 'passed' else 'interested' end,
    'matchdeal_swipes', s.id,
    m.catalog_entity_id::text || ':' || so.membership_id::text || ':swipe:' || s.id::text,
    e.is_test_or_internal, s.created_at
  from matchdeal_swipes s
  join matchdeal_profiles ap on ap.id = s.actor_profile_id and ap.kind = 'investor'
  join matchdeal_investor_members m on m.id = ap.membership_id
  join matchdeal_profiles so on so.id = s.target_profile_id and so.kind = 'startup'
  join investor_opportunity_episodes e on e.investor_catalog_entity_id = m.catalog_entity_id and e.org_id = so.membership_id and e.closed_at is null
  where not exists (
    select 1 from investor_relationship_decisions d
    where d.investor_catalog_entity_id = m.catalog_entity_id and d.org_id = so.membership_id
      and date_trunc('minute', d.decided_at) = date_trunc('minute', s.created_at)
  )
  on conflict (dedup_key) where dedup_key is not null do nothing;

  -- 3) investor_watches -> a 'condicao' event (watch_set), never a
  -- decision. Resolved to the firm via the requester's own
  -- investor_catalog_entity_id column (already firm-scoped on this table).
  insert into investor_opportunity_episodes (investor_catalog_entity_id, org_id, opened_at, is_test_or_internal)
  select w.investor_catalog_entity_id, w.org_id, w.requested_at,
    coalesce(w.investor_catalog_entity_id = any(v_test_entities), false) or coalesce(w.investor_catalog_entity_id = any(v_internal_entities), false)
  from investor_watches w
  on conflict (investor_catalog_entity_id, org_id) where closed_at is null do nothing;

  insert into investor_signal_events (episode_id, level, kind, source_table, source_id, dedup_key, is_test_or_internal, created_at)
  select e.id, 'condicao', 'watch_set', 'investor_watches', w.id,
    w.investor_catalog_entity_id::text || ':' || w.org_id::text || ':watch:' || w.id::text,
    e.is_test_or_internal, w.requested_at
  from investor_watches w
  join investor_opportunity_episodes e on e.investor_catalog_entity_id = w.investor_catalog_entity_id and e.org_id = w.org_id and e.closed_at is null
  on conflict (dedup_key) where dedup_key is not null do nothing;

  -- 4) investor_pipeline_admissions -> one 'sistema:wave_presented' event
  -- per historical admission, matching the live path's own event shape
  -- (Pedido H reuses investor_signal_events, no separate table — see that
  -- pedido's own note in DECISIONS.md).
  insert into investor_opportunity_episodes (investor_catalog_entity_id, org_id, opened_at, is_test_or_internal)
  select a.investor_catalog_entity_id, a.org_id, a.admitted_at,
    coalesce(a.investor_catalog_entity_id = any(v_test_entities), false) or coalesce(a.investor_catalog_entity_id = any(v_internal_entities), false)
  from investor_pipeline_admissions a
  on conflict (investor_catalog_entity_id, org_id) where closed_at is null do nothing;

  insert into investor_signal_events (episode_id, level, kind, source_table, source_id, dedup_key, snapshot, is_test_or_internal, created_at)
  select e.id, 'sistema', 'wave_presented', 'investor_pipeline_admissions', a.id,
    a.investor_catalog_entity_id::text || ':' || a.org_id::text || ':admission:' || a.id::text,
    jsonb_build_object('visibility', 'presented'), e.is_test_or_internal, a.admitted_at
  from investor_pipeline_admissions a
  join investor_opportunity_episodes e on e.investor_catalog_entity_id = a.investor_catalog_entity_id and e.org_id = a.org_id and e.closed_at is null
  on conflict (dedup_key) where dedup_key is not null do nothing;
end $$;
