-- RETROACTIVE migration (prompt 52). Captures schema that ALREADY EXISTS
-- and is ALREADY RUNNING in production (project wkjcaoqdvhykrfacsylr) —
-- applied directly via SQL Editor / MCP over several sessions between
-- 2026-07-27 and 2026-07-29, never as a versioned migration file. This
-- file changes nothing about production behaviour; it exists so the repo
-- stops lying about what MatchDeal actually is. Written idempotently
-- (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS + CREATE) so
-- it can run against production with zero effect.
--
-- TESTING CAVEAT (2026-07-29): the intended validation was a fresh
-- Supabase branch (a genuinely empty database, proving this file
-- reproduces the schema from nothing) — Supabase branching returned
-- "Branching is supported only on the Pro plan or above" for this project
-- (org uukdvxrvfnjignarrhee), which is not on that plan. What WAS actually
-- verified instead: this entire file applied inside a transaction against
-- PRODUCTION and then rolled back — confirms the SQL is syntactically
-- correct top to bottom and genuinely idempotent (zero row/schema changes
-- when everything already exists, checked via row counts before/after).
-- It does NOT prove clean-database reproduction — the CREATE TABLE IF NOT
-- EXISTS bodies were never exercised as CREATE paths, only skipped. If a
-- true clean-room run matters before this is trusted for disaster
-- recovery, either enable Supabase Pro branching (this project's
-- get_cost quoted $0.01344/hour) or apply this file to a brand-new,
-- throwaway Supabase project.
--
-- Dumped 2026-07-29 via pg_get_constraintdef/pg_get_functiondef/
-- pg_get_triggerdef/pg_get_viewdef against the live database — this is a
-- faithful capture, not a redesign. Every comment inside function bodies
-- and on columns below is the ORIGINAL author's comment, preserved as-is.
--
-- Scope: MatchDeal's own 16 tables + 1 view + 26 functions + 2 triggers +
-- 1 pg_cron job. Does NOT touch anything outside the matchdeal_* namespace
-- — no changes to access_grants, catalog_entities, org_members, folders,
-- etc., even though several matchdeal_* functions reference them by FK or
-- by query (those tables already exist from earlier migrations).
--
-- OBSERVATIONS — not corrected here, per the prompt's own instruction to
-- register and ask rather than fix while capturing:
--
--   1. TWO separate, apparently redundant pairing mechanisms exist for the
--      same job (turning a scanned QR token into a real session):
--        a) the matchdeal-pair Edge Function (supabase/functions/matchdeal-pair/
--           in this repo as of this same commit) — atomic UPDATE claim,
--           imports the org's profile, copies the logo, mints a magic link.
--        b) matchdeal_pairing_seal(token) + matchdeal_pairing_poll(token) —
--           a plain SQL RPC pair with the SAME "claim once" shape (seal sets
--           membership_id/used_at; poll reads back session_email/otp), but
--           simpler — no profile auto-import, no logo copy, just seals the
--           row against the caller's OWN already-authenticated session
--           (matchdeal_current_membership_ids()), rather than minting a NEW
--           session via a fresh OTP the way the Edge Function does.
--      These aren't obviously the same flow wearing two names — the Edge
--      Function mints a NEW session for an unauthenticated phone; the
--      seal/poll pair ASSUMES the caller already has a session (probably
--      the investor mobile app, already signed in, scanning a startup's
--      founder QR the other direction). Flagging because two independent
--      pairing paths into the same table is exactly the kind of thing that
--      silently drifts out of sync — not fixing without your steer on
--      which one is the current one.
--   2. matchdeal_profiles.membership_id and matchdeal_matches.superseded_from_match_id
--      carry no FK constraint in production (unlike almost every other
--      cross-table reference here, which are all real FKs). membership_id
--      is polymorphic by design (org_members.org_id when kind='startup',
--      matchdeal_investor_members.id when kind='investor' — a single FK
--      can't express that), so this is very likely intentional, not an
--      oversight — captured as-is, not added.
--   3. matchdeal_profiles.preferred_contact_channel carries a column
--      comment: "Nunca mostrar à startup na UI... tem de constar na
--      política de privacidade como finalidade de tratamento." Flagging
--      because this is a live privacy-policy commitment sitting in a column
--      comment, not in any actual policy document as far as this repo's
--      search could find (DECISIONS.md has zero MatchDeal mentions,
--      confirmed in this session's earlier audit) — worth checking that
--      commitment is actually reflected somewhere a user could read it.

-- ============================================================
-- 1. TABLES (constraints inline — IF NOT EXISTS skips the whole
--    statement, constraints included, when the table already exists)
-- ============================================================

create table if not exists public.matchdeal_flags (
  key text primary key,
  enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.matchdeal_investor_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_entity_id uuid not null references public.catalog_entities(id),
  -- status='active' obrigatório para dar acesso — ver comentário em
  -- matchdeal_current_membership_ids() mais abaixo: um vínculo revogado
  -- não pode continuar a dar acesso aos perfis/matches da entidade.
  status text not null default 'active' check (status = any (array['active','revoked'])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, catalog_entity_id)
);

create table if not exists public.matchdeal_profiles (
  id uuid primary key default gen_random_uuid(),
  -- Polimórfico por design: org_members.org_id quando kind='startup',
  -- matchdeal_investor_members.id quando kind='investor'. Uma FK única não
  -- consegue expressar isto — sem FK aqui é intencional, não descuido.
  membership_id uuid not null,
  kind text not null check (kind = any (array['startup','investor'])),
  is_complete boolean not null default false,
  is_visible boolean not null default false,
  photo_url text,
  website text,
  sectors text[] not null default '{}'::text[],
  country text,
  description text,
  target_round_amount numeric,
  investment_stage_sought text check (investment_stage_sought = any (array['pre_seed','seed','series_a','series_b_plus','growth'])),
  company_phase text check (company_phase = any (array['concept','prototype','pilot','launch','growth'])),
  founded_year integer,
  intellectual_property text,
  revenue text,
  team_summary text,
  pitch_deck_url text,
  gallery_urls text[] not null default '{}'::text[],
  contact text,
  representative_name text,
  entity_name text,
  entity_logo_url text,
  entity_type text check (entity_type = any (array['vc','corporate_vc','family_office','angel_network','venture_studio','public_institutional'])),
  representative_linkedin text,
  stages_invested text[] not null default '{}'::text[],
  phases_accepted text[] not null default '{}'::text[],
  geographies text[] not null default '{}'::text[],
  company_types text[] not null default '{}'::text[],
  specific_criteria text,
  ticket_min numeric,
  ticket_max numeric,
  lead_or_colead text check (lead_or_colead = any (array['lead','co_lead'])),
  instruments text[] not null default '{}'::text[],
  active_fund text,
  portfolio_companies text,
  recent_investments text,
  -- Nunca mostrar à startup na UI. Dado interno para otimização do
  -- acompanhamento — tem de constar na política de privacidade como
  -- finalidade de tratamento, mesmo não sendo visível no ecrã.
  preferred_contact_channel text check (preferred_contact_channel = any (array['form','email','linkedin','introduction','event'])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- tier_a = Elementary my dear / Boy Scout; tier_b = List of Suspects /
  -- Pro Spotter; tier_c = Its the Butler / Ace Sleuth. Ver
  -- claude/matchdeal_spec_v1_20260727.md §13.
  plan_tier text not null default 'tier_a' check (plan_tier = any (array['tier_a','tier_b','tier_c'])),
  unique (membership_id, kind)
);

create table if not exists public.matchdeal_device_links (
  id uuid primary key default gen_random_uuid(),
  pairing_token text not null unique,
  membership_id uuid,
  user_id uuid references auth.users(id) on delete cascade,
  device_id text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  session_email text,
  -- OTP de uso único (Supabase generateLink) para o telemóvel trocar por
  -- uma sessão real via auth.verifyOtp. O próprio telemóvel deve limpar
  -- esta coluna (set null) depois de a usar, como defesa em profundidade —
  -- o OTP já é de uso único do lado do Supabase Auth, isto é só para não
  -- deixar o valor parado na tabela.
  session_email_otp text
);

create table if not exists public.matchdeal_swipes (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  target_profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  direction text not null check (direction = any (array['like','pass'])),
  created_at timestamptz not null default now(),
  unique (actor_profile_id, target_profile_id)
);

create table if not exists public.matchdeal_exposures (
  id uuid primary key default gen_random_uuid(),
  viewer_profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  shown_profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  shown_at timestamptz not null default now()
);

create table if not exists public.matchdeal_entity_blocks (
  id uuid primary key default gen_random_uuid(),
  startup_profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  catalog_entity_id uuid not null references public.catalog_entities(id),
  created_at timestamptz not null default now(),
  unique (startup_profile_id, catalog_entity_id)
);

create table if not exists public.matchdeal_matches (
  id uuid primary key default gen_random_uuid(),
  startup_profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  investor_catalog_entity_id uuid not null references public.catalog_entities(id),
  status text not null check (status = any (array['pending_consent','declined_by_startup','active','expired_no_followup','closed_by_startup'])),
  active_investor_profile_id uuid references public.matchdeal_profiles(id),
  dataroom_granted_at timestamptz,
  cooldown_until timestamptz,
  -- Sem FK a si própria com ON DELETE — ver observação #2 no topo do ficheiro.
  superseded_from_match_id uuid references public.matchdeal_matches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.matchdeal_responsibility_queue (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matchdeal_matches(id) on delete cascade,
  investor_profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  "position" integer not null,
  status text not null check (status = any (array['waiting','active','expired','declined'])),
  joined_at timestamptz not null default now(),
  became_active_at timestamptz,
  sla_deadline timestamptz,
  used_still_interested_reset boolean not null default false,
  unique (match_id, investor_profile_id),
  unique (match_id, "position")
);

create table if not exists public.matchdeal_dataroom_consent (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.matchdeal_matches(id) on delete cascade,
  granted boolean not null,
  decline_reason text,
  decided_at timestamptz not null default now()
);

create table if not exists public.matchdeal_match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matchdeal_matches(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.matchdeal_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matchdeal_matches(id) on delete cascade,
  sender_profile_id uuid references public.matchdeal_profiles(id),
  kind text not null check (kind = any (array['system','user','meeting_proposal'])),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.matchdeal_meeting_proposals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matchdeal_matches(id) on delete cascade,
  proposed_by_profile_id uuid not null references public.matchdeal_profiles(id),
  proposed_slots timestamptz[] not null default '{}'::timestamptz[],
  confirmed_slot timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.matchdeal_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  kind text not null check (kind = any (array['super_like_received','contact_ended','match_created','reassigned'])),
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.matchdeal_weekly_activity (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  week_start date not null,
  shown_count integer not null default 0,
  like_count integer not null default 0,
  undo_count integer not null default 0,
  super_like_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, week_start)
);

create table if not exists public.matchdeal_boosts (
  id uuid primary key default gen_random_uuid(),
  boosted_profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  investor_profile_id uuid not null references public.matchdeal_profiles(id) on delete cascade,
  week_start date not null,
  created_at timestamptz not null default now(),
  unique (boosted_profile_id, investor_profile_id, week_start)
);

-- ============================================================
-- 2. INDEXES (beyond the PK/UNIQUE ones already declared inline above)
-- ============================================================

create index if not exists matchdeal_boosts_investor_idx on public.matchdeal_boosts using btree (investor_profile_id, week_start);
create index if not exists matchdeal_device_links_token_idx on public.matchdeal_device_links using btree (pairing_token);
create index if not exists matchdeal_entity_blocks_startup_idx on public.matchdeal_entity_blocks using btree (startup_profile_id);
create index if not exists matchdeal_exposures_viewer_idx on public.matchdeal_exposures using btree (viewer_profile_id, shown_at desc);
create index if not exists matchdeal_investor_members_entity_idx on public.matchdeal_investor_members using btree (catalog_entity_id);
create index if not exists matchdeal_matches_entity_idx on public.matchdeal_matches using btree (investor_catalog_entity_id);
create index if not exists matchdeal_matches_startup_idx on public.matchdeal_matches using btree (startup_profile_id);
-- Um único match "em aberto" (pending_consent/active) por par startup×entidade.
create unique index if not exists matchdeal_one_open_match_per_pair on public.matchdeal_matches using btree (startup_profile_id, investor_catalog_entity_id)
  where (status = any (array['pending_consent','active']));
create index if not exists matchdeal_messages_match_idx on public.matchdeal_messages using btree (match_id, created_at);
create index if not exists matchdeal_notifications_profile_idx on public.matchdeal_notifications using btree (profile_id, created_at desc);
create index if not exists matchdeal_queue_match_idx on public.matchdeal_responsibility_queue using btree (match_id, "position");
create index if not exists matchdeal_swipes_target_idx on public.matchdeal_swipes using btree (target_profile_id, direction);

-- ============================================================
-- 3. FUNCTIONS (26). Bodies are the verbatim production definitions,
--    including every original Portuguese comment.
-- ============================================================

create or replace function public.matchdeal_current_week_start() returns date
language sql stable as $$
  select date_trunc('week', now())::date;
$$;

create or replace function public.matchdeal_current_membership_ids() returns setof uuid
language sql stable security definer as $$
  select org_id from public.org_members where user_id = auth.uid()
  union
  -- status='active' é obrigatório: um vínculo revogado não pode continuar a
  -- dar acesso aos perfis/matches da entidade. Como esta função alimenta
  -- TODAS as policies abaixo, o filtro aqui revoga o acesso em todo o
  -- produto de uma vez — e é por isso que a linha se revoga em vez de se
  -- apagar (ver comentário da tabela em 0001).
  select id from public.matchdeal_investor_members
  where user_id = auth.uid() and status = 'active';
$$;

create or replace function public.matchdeal_current_profile_ids() returns setof uuid
language sql stable security definer as $$
  select id from public.matchdeal_profiles
  where membership_id in (select public.matchdeal_current_membership_ids());
$$;

create or replace function public.matchdeal_my_profile() returns matchdeal_profiles
language sql stable security definer as $$
  select * from public.matchdeal_profiles
  where id in (select public.matchdeal_current_profile_ids())
  limit 1;
$$;

create or replace function public.matchdeal_hype_weights()
returns table(w_likes_week numeric, w_growth numeric, w_approval_rate numeric, w_completeness numeric, w_super_likes numeric, completeness_min numeric, hype_threshold numeric)
language sql immutable as $$
  select
    1.0::numeric,   -- likes recebidos esta semana (normalizado 0-1 face ao máximo da semana)
    1.5::numeric,   -- ritmo de crescimento face à semana anterior
    2.0::numeric,   -- taxa de aprovação (likes / vezes que foi mostrada)
    0.5::numeric,   -- bónus de completude
    2.5::numeric,   -- super likes recebidos esta semana
    0.90::numeric,  -- completude mínima para o bónus (>=90%)
    0.60::numeric;  -- score normalizado a partir do qual o badge "Hype" aparece
$$;

create or replace function public.matchdeal_tier_limits(p_tier text)
returns table(deck_size integer, like_limit integer, undo_limit integer)
language sql immutable as $$
  select
    case p_tier when 'tier_a' then 3 when 'tier_b' then 10 when 'tier_c' then 20 else 3 end,
    case p_tier when 'tier_a' then 1 when 'tier_b' then 5 when 'tier_c' then 10 else 1 end,
    case p_tier when 'tier_a' then 0 when 'tier_b' then 2 when 'tier_c' then null else 0 end;
$$;

create or replace function public.matchdeal_get_or_create_weekly_activity(p_profile_id uuid) returns matchdeal_weekly_activity
language plpgsql security definer as $$
declare
  v_row public.matchdeal_weekly_activity;
  v_week date := public.matchdeal_current_week_start();
begin
  select * into v_row from public.matchdeal_weekly_activity
  where profile_id = p_profile_id and week_start = v_week for update;
  if v_row.id is null then
    insert into public.matchdeal_weekly_activity (profile_id, week_start)
    values (p_profile_id, v_week) returning * into v_row;
  end if;
  return v_row;
end; $$;

create or replace function public.matchdeal_recompute_profile_completeness() returns trigger
language plpgsql as $$
begin
  if new.kind = 'startup' then
    new.is_complete := (
      new.photo_url is not null and
      new.website is not null and
      array_length(new.sectors, 1) > 0 and
      new.description is not null and
      new.country is not null and
      new.investment_stage_sought is not null and
      new.company_phase is not null
    );
  elsif new.kind = 'investor' then
    new.is_complete := (
      new.representative_name is not null and
      new.entity_name is not null and
      array_length(new.stages_invested, 1) > 0 and
      array_length(new.geographies, 1) > 0 and
      new.country is not null and
      new.website is not null
    );
  end if;

  -- Na v1 visibilidade = completude. Mantido como coluna separada para
  -- permitir no futuro suspensão manual (abuso, disputa) sem mexer no
  -- cálculo de completude.
  new.is_visible := new.is_complete;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.matchdeal_record_exposure(p_viewer_profile_id uuid, p_shown_profile_id uuid) returns void
language plpgsql security definer as $$
begin
  insert into public.matchdeal_exposures (viewer_profile_id, shown_profile_id)
  values (p_viewer_profile_id, p_shown_profile_id);
  perform public.matchdeal_get_or_create_weekly_activity(p_viewer_profile_id);
  update public.matchdeal_weekly_activity
    set shown_count = shown_count + 1, updated_at = now()
    where profile_id = p_viewer_profile_id and week_start = public.matchdeal_current_week_start();
end; $$;

create or replace function public.matchdeal_eligible_deck(p_viewer_profile_id uuid, p_limit integer default 20) returns setof matchdeal_profiles
language plpgsql security definer as $$
declare
  v_viewer public.matchdeal_profiles;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
  v_remaining int;
begin
  select * into v_viewer from public.matchdeal_profiles where id = p_viewer_profile_id;
  v_weekly := public.matchdeal_get_or_create_weekly_activity(p_viewer_profile_id);
  select * into v_limits from public.matchdeal_tier_limits(v_viewer.plan_tier);
  v_remaining := greatest(v_limits.deck_size - v_weekly.shown_count, 0);
  if v_remaining = 0 then return; end if;
  return query
  select p.* from public.matchdeal_profiles p
  where p.is_visible = true
    and p.kind <> v_viewer.kind
    and p.id not in (
      select target_profile_id from public.matchdeal_swipes where actor_profile_id = p_viewer_profile_id
    )
    and (v_viewer.kind <> 'investor' or v_viewer.sectors = '{}' or p.sectors && v_viewer.sectors)
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.stages_invested,1) is null or p.investment_stage_sought = any(v_viewer.stages_invested))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.geographies,1) is null or p.country = any(v_viewer.geographies))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.phases_accepted,1) is null or p.company_phase = any(v_viewer.phases_accepted))
    and (v_viewer.kind <> 'startup' or array_length(p.stages_invested,1) is null or v_viewer.investment_stage_sought = any(p.stages_invested))
    and (v_viewer.kind <> 'startup' or array_length(p.geographies,1) is null or v_viewer.country = any(p.geographies))
    and (v_viewer.kind <> 'startup' or array_length(p.phases_accepted,1) is null or v_viewer.company_phase = any(p.phases_accepted))
    -- Bloqueio de longa duração (§5.4). Vale nos dois sentidos: a startup
    -- não vê a entidade que bloqueou, e ninguém dessa entidade a vê a ela.
    and not exists (
      select 1 from public.matchdeal_entity_blocks bl
      where (v_viewer.kind = 'startup'
             and bl.startup_profile_id = p_viewer_profile_id
             and bl.catalog_entity_id = (
               select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = p.membership_id))
         or (v_viewer.kind = 'investor'
             and bl.startup_profile_id = p.id
             and bl.catalog_entity_id = (
               select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = v_viewer.membership_id))
    )
    -- Cooldown (30d recusa/fim pela startup, 90d fila esgotada por SLA).
    and not exists (
      select 1 from public.matchdeal_matches m
      where m.cooldown_until is not null and m.cooldown_until > now()
        and (
          (v_viewer.kind = 'startup' and m.startup_profile_id = p_viewer_profile_id
            and m.investor_catalog_entity_id = (
              select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = p.membership_id))
          or
          (v_viewer.kind = 'investor' and p.id = m.startup_profile_id
            and m.investor_catalog_entity_id = (
              select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = v_viewer.membership_id))
        )
    )
  order by
    (not exists (
      select 1 from public.matchdeal_exposures e
      where e.viewer_profile_id = p_viewer_profile_id
        and e.shown_profile_id = p.id
        and e.shown_at > now() - interval '7 days'
    )) desc,
    random()
  limit least(p_limit, v_remaining);
end; $$;

create or replace function public.matchdeal_handle_mutual_match(p_startup_profile_id uuid, p_investor_profile_id uuid) returns uuid
language plpgsql security definer as $$
declare
  v_entity_id uuid;
  v_match_id uuid;
  v_next_position int;
begin
  -- Resolve a entidade investidora (VC/FO) a partir do vínculo provisório
  -- pessoa→entidade (0004), para agrupar vários investidores da mesma
  -- entidade no mesmo match. matchdeal_profiles.membership_id aponta para
  -- matchdeal_investor_members.id quando kind='investor'.
  select im.catalog_entity_id into v_entity_id
  from public.matchdeal_profiles p
  join public.matchdeal_investor_members im on im.id = p.membership_id
  where p.id = p_investor_profile_id;

  if v_entity_id is null then
    raise exception 'Perfil de investidor % não está vinculado a nenhuma entidade do catálogo.', p_investor_profile_id;
  end if;

  -- Tranca a linha do par (startup, entidade) se já existir, para evitar
  -- condição de corrida quando dois investidores da mesma entidade dão
  -- swipe em simultâneo.
  select id into v_match_id
  from public.matchdeal_matches
  where startup_profile_id = p_startup_profile_id
    and investor_catalog_entity_id = v_entity_id
    and status in ('pending_consent', 'active')
  for update;

  if v_match_id is null then
    -- Primeiro investidor desta entidade a fazer match com esta startup.
    insert into public.matchdeal_matches (startup_profile_id, investor_catalog_entity_id, status, active_investor_profile_id)
    values (p_startup_profile_id, v_entity_id, 'pending_consent', p_investor_profile_id)
    returning id into v_match_id;

    insert into public.matchdeal_responsibility_queue (match_id, investor_profile_id, position, status, became_active_at)
    values (v_match_id, p_investor_profile_id, 1, 'active', now());

    insert into public.matchdeal_match_events (match_id, event_type, payload)
    values (v_match_id, 'created', jsonb_build_object('active_investor_profile_id', p_investor_profile_id));

    insert into public.matchdeal_messages (match_id, sender_profile_id, kind, body)
    values (v_match_id, null, 'system',
      'É um match! A pedir autorização à startup para partilhar o data room.');

    return v_match_id;
  end if;

  -- Já existe processo aberto com outro investidor desta entidade — este
  -- investidor entra na fila por ordem de chegada.
  if exists (
    select 1 from public.matchdeal_responsibility_queue
    where match_id = v_match_id and investor_profile_id = p_investor_profile_id
  ) then
    return v_match_id; -- já estava na fila (chamada repetida)
  end if;

  select coalesce(max(position), 0) + 1 into v_next_position
  from public.matchdeal_responsibility_queue
  where match_id = v_match_id;

  insert into public.matchdeal_responsibility_queue (match_id, investor_profile_id, position, status)
  values (v_match_id, p_investor_profile_id, v_next_position, 'waiting');

  insert into public.matchdeal_messages (match_id, sender_profile_id, kind, body)
  values (v_match_id, null, 'system',
    'Esta startup já está em contacto com um colega da tua equipa através do MatchDeal. Se o processo não avançar, a pasta passa automaticamente para ti.');

  return v_match_id;
end;
$$;

create or replace function public.matchdeal_record_swipe(p_actor_profile_id uuid, p_target_profile_id uuid, p_direction text) returns uuid
language plpgsql security definer as $$
declare
  v_reverse_like_exists boolean;
  v_actor_kind text;
  v_target_kind text;
  v_startup_profile_id uuid;
  v_investor_profile_id uuid;
  v_match_id uuid;
  v_actor public.matchdeal_profiles;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
begin
  if p_direction not in ('like','pass') then
    raise exception 'direction inválida: %', p_direction;
  end if;
  select * into v_actor from public.matchdeal_profiles where id = p_actor_profile_id;
  if p_direction = 'like' then
    v_weekly := public.matchdeal_get_or_create_weekly_activity(p_actor_profile_id);
    select * into v_limits from public.matchdeal_tier_limits(v_actor.plan_tier);
    if v_weekly.like_count >= v_limits.like_limit then
      raise exception 'MATCHDEAL_LIKE_LIMIT_REACHED';
    end if;
  end if;
  insert into public.matchdeal_swipes (actor_profile_id, target_profile_id, direction)
  values (p_actor_profile_id, p_target_profile_id, p_direction)
  on conflict (actor_profile_id, target_profile_id) do update set direction = excluded.direction;
  if p_direction = 'pass' then return null; end if;
  update public.matchdeal_weekly_activity
    set like_count = like_count + 1, updated_at = now()
    where profile_id = p_actor_profile_id and week_start = public.matchdeal_current_week_start();
  v_actor_kind := v_actor.kind;
  select kind into v_target_kind from public.matchdeal_profiles where id = p_target_profile_id;
  if v_actor_kind = v_target_kind then
    raise exception 'swipe entre dois perfis do mesmo tipo não é suportado';
  end if;
  select exists (
    select 1 from public.matchdeal_swipes
    where actor_profile_id = p_target_profile_id
      and target_profile_id = p_actor_profile_id and direction = 'like'
  ) into v_reverse_like_exists;
  if not v_reverse_like_exists then return null; end if;
  if v_actor_kind = 'startup' then
    v_startup_profile_id := p_actor_profile_id;
    v_investor_profile_id := p_target_profile_id;
  else
    v_startup_profile_id := p_target_profile_id;
    v_investor_profile_id := p_actor_profile_id;
  end if;
  v_match_id := public.matchdeal_handle_mutual_match(v_startup_profile_id, v_investor_profile_id);
  return v_match_id;
end; $$;

create or replace function public.matchdeal_undo_swipe(p_actor_profile_id uuid, p_target_profile_id uuid) returns uuid
language plpgsql security definer as $$
declare
  v_actor public.matchdeal_profiles;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
  v_current_direction text;
begin
  select * into v_actor from public.matchdeal_profiles where id = p_actor_profile_id;
  select * into v_limits from public.matchdeal_tier_limits(v_actor.plan_tier);
  select direction into v_current_direction
  from public.matchdeal_swipes
  where actor_profile_id = p_actor_profile_id and target_profile_id = p_target_profile_id;
  if v_current_direction is distinct from 'pass' then
    raise exception 'Só é possível reconsiderar perfis rejeitados.';
  end if;
  v_weekly := public.matchdeal_get_or_create_weekly_activity(p_actor_profile_id);
  if v_limits.undo_limit is not null and v_weekly.undo_count >= v_limits.undo_limit then
    raise exception 'MATCHDEAL_UNDO_LIMIT_REACHED';
  end if;
  if v_weekly.like_count >= v_limits.like_limit then
    raise exception 'MATCHDEAL_LIKE_LIMIT_REACHED';
  end if;
  update public.matchdeal_weekly_activity
    set undo_count = undo_count + 1, updated_at = now()
    where profile_id = p_actor_profile_id and week_start = public.matchdeal_current_week_start();
  return public.matchdeal_record_swipe(p_actor_profile_id, p_target_profile_id, 'like');
end; $$;

create or replace function public.matchdeal_activate_super_like(p_actor_profile_id uuid, p_target_profile_id uuid) returns void
language plpgsql security definer as $$
declare
  v_actor public.matchdeal_profiles;
  v_target public.matchdeal_profiles;
  v_weekly public.matchdeal_weekly_activity;
  v_week date := public.matchdeal_current_week_start();
begin
  select * into v_actor from public.matchdeal_profiles where id = p_actor_profile_id;
  if v_actor.plan_tier <> 'tier_b' then
    raise exception 'MATCHDEAL_SUPER_LIKE_NOT_AVAILABLE';
  end if;
  v_weekly := public.matchdeal_get_or_create_weekly_activity(p_actor_profile_id);
  if v_weekly.super_like_used_at is not null then
    raise exception 'MATCHDEAL_SUPER_LIKE_ALREADY_USED';
  end if;
  select * into v_target from public.matchdeal_profiles where id = p_target_profile_id;
  update public.matchdeal_weekly_activity
    set super_like_used_at = now(), updated_at = now()
    where profile_id = p_actor_profile_id and week_start = v_week;

  if v_actor.kind = 'investor' and v_target.kind = 'startup' then
    -- Registo de quem deu o quê (auditoria + input do hype score global).
    insert into public.matchdeal_boosts (boosted_profile_id, investor_profile_id, week_start)
    values (p_target_profile_id, p_actor_profile_id, v_week)
    on conflict do nothing;

    -- §15.4 — a startup sabe que recebeu, não sabe de quem. A tabela de
    -- notificações não tem coluna de autor, por construção.
    insert into public.matchdeal_notifications (profile_id, kind, body)
    values (p_target_profile_id, 'super_like_received',
      'Recebeste um super like. Vais saber quem foi se houver match.');
  end if;

  perform public.matchdeal_record_swipe(p_actor_profile_id, p_target_profile_id, 'like');
end; $$;

create or replace function public.matchdeal_decide_dataroom_consent(p_match_id uuid, p_granted boolean, p_decline_reason text default null::text) returns void
language plpgsql security definer as $$
declare
  v_active_queue_id uuid;
begin
  insert into public.matchdeal_dataroom_consent (match_id, granted, decline_reason)
  values (p_match_id, p_granted, p_decline_reason)
  on conflict (match_id) do update
    set granted = excluded.granted, decline_reason = excluded.decline_reason, decided_at = now();

  if p_granted then
    update public.matchdeal_matches
      set status = 'active', dataroom_granted_at = now(), updated_at = now()
      where id = p_match_id;

    select id into v_active_queue_id
    from public.matchdeal_responsibility_queue
    where match_id = p_match_id and status = 'active';

    update public.matchdeal_responsibility_queue
      set sla_deadline = now() + interval '7 days'
      where id = v_active_queue_id;

    -- Acesso real ao data room do Sherlock Deal (0006).
    perform public.matchdeal_grant_dataroom(p_match_id);

    insert into public.matchdeal_match_events (match_id, event_type)
    values (p_match_id, 'consent_granted');

    insert into public.matchdeal_messages (match_id, sender_profile_id, kind, body)
    values (p_match_id, null, 'system',
      'A startup autorizou a partilha do data room. Já podes ver os documentos no Sherlock Deal e conversar livremente aqui.');
  else
    update public.matchdeal_matches
      set status = 'declined_by_startup', cooldown_until = now() + interval '30 days', updated_at = now()
      where id = p_match_id;

    update public.matchdeal_responsibility_queue
      set status = 'declined'
      where match_id = p_match_id;

    insert into public.matchdeal_match_events (match_id, event_type, payload)
    values (p_match_id, 'consent_declined', jsonb_build_object('reason', p_decline_reason));

    insert into public.matchdeal_messages (match_id, sender_profile_id, kind, body)
    values (p_match_id, null, 'system',
      'A startup optou por não partilhar o data room neste momento. O match fica sem efeito.');
  end if;
end; $$;

create or replace function public.matchdeal_grant_dataroom(p_match_id uuid) returns uuid
language plpgsql security definer as $$
declare
  v_org_id uuid;
  v_folder_id uuid;
  v_email text;
  v_grant_id uuid;
  v_investor_profile_id uuid;
begin
  select sp.membership_id, m.active_investor_profile_id
    into v_org_id, v_investor_profile_id
  from public.matchdeal_matches m
  join public.matchdeal_profiles sp on sp.id = m.startup_profile_id
  where m.id = p_match_id;

  if v_org_id is null or v_investor_profile_id is null then
    raise exception 'MATCHDEAL_MATCH_INCOMPLETE';
  end if;

  select u.email into v_email
  from public.matchdeal_profiles ip
  join public.matchdeal_investor_members im on im.id = ip.membership_id
  join auth.users u on u.id = im.user_id
  where ip.id = v_investor_profile_id;

  if v_email is null then
    raise exception 'MATCHDEAL_INVESTOR_EMAIL_UNKNOWN';
  end if;

  select f.id into v_folder_id
  from public.folders f
  where f.org_id = v_org_id and f.kind = 'data_room' and f.parent_id is null
  order by f.position asc
  limit 1;

  if v_folder_id is null then
    raise exception 'MATCHDEAL_NO_DATAROOM_FOLDER';
  end if;

  -- Reabre um grant desta app que tenha sido revogado antes, em vez de
  -- empilhar linhas por cada ciclo de match.
  update public.access_grants
    set revoked_at = null, granted_at = now()
    where org_id = v_org_id and grantee_email = v_email
      and folder_id = v_folder_id and source = 'matchdeal'
    returning id into v_grant_id;

  if v_grant_id is null then
    insert into public.access_grants (org_id, grantee_email, folder_id, source, note)
    values (v_org_id, v_email, v_folder_id, 'matchdeal',
            'Concedido automaticamente pelo MatchDeal no consentimento de um match.')
    returning id into v_grant_id;
  end if;

  return v_grant_id;
end; $$;

create or replace function public.matchdeal_revoke_dataroom(p_match_id uuid) returns integer
language plpgsql security definer as $$
declare
  v_org_id uuid;
  v_email text;
  v_count int;
begin
  select sp.membership_id into v_org_id
  from public.matchdeal_matches m
  join public.matchdeal_profiles sp on sp.id = m.startup_profile_id
  where m.id = p_match_id;

  select u.email into v_email
  from public.matchdeal_matches m
  join public.matchdeal_profiles ip on ip.id = m.active_investor_profile_id
  join public.matchdeal_investor_members im on im.id = ip.membership_id
  join auth.users u on u.id = im.user_id
  where m.id = p_match_id;

  if v_org_id is null or v_email is null then return 0; end if;

  update public.access_grants
    set revoked_at = now()
    where org_id = v_org_id
      and grantee_email = v_email
      and source = 'matchdeal'
      and revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end; $$;

create or replace function public.matchdeal_reassign_next(p_match_id uuid) returns void
language plpgsql security definer as $$
declare
  v_next record;
begin
  update public.matchdeal_responsibility_queue
    set status = 'expired'
    where match_id = p_match_id and status = 'active';

  select * into v_next
  from public.matchdeal_responsibility_queue
  where match_id = p_match_id and status = 'waiting'
  order by position asc
  limit 1;

  if v_next.id is null then
    -- Fila esgotada — nenhum investidor desta entidade acompanhou a tempo.
    update public.matchdeal_matches
      set status = 'expired_no_followup', cooldown_until = now() + interval '90 days', updated_at = now()
      where id = p_match_id;

    insert into public.matchdeal_match_events (match_id, event_type)
    values (p_match_id, 'expired');

    insert into public.matchdeal_messages (match_id, sender_profile_id, kind, body)
    values (p_match_id, null, 'system',
      'Nenhum investidor desta equipa deu seguimento a tempo. O processo foi encerrado.');
    return;
  end if;

  update public.matchdeal_responsibility_queue
    set status = 'active', became_active_at = now(), sla_deadline = now() + interval '7 days'
    where id = v_next.id;

  update public.matchdeal_matches
    set active_investor_profile_id = v_next.investor_profile_id, updated_at = now()
    where id = p_match_id;

  insert into public.matchdeal_match_events (match_id, event_type, payload)
  values (p_match_id, 'reassigned', jsonb_build_object('new_active_investor_profile_id', v_next.investor_profile_id));

  insert into public.matchdeal_messages (match_id, sender_profile_id, kind, body)
  values (p_match_id, null, 'system',
    'O acompanhamento deste processo passou para um novo investidor da equipa.');
end;
$$;

create or replace function public.matchdeal_sweep_sla_timeouts() returns integer
language plpgsql security definer as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    select match_id from public.matchdeal_responsibility_queue
    where status = 'active' and sla_deadline is not null and sla_deadline < now()
  loop
    perform public.matchdeal_reassign_next(v_row.match_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.matchdeal_record_investor_action(p_match_id uuid) returns void
language plpgsql security definer as $$
begin
  update public.matchdeal_responsibility_queue
    set sla_deadline = now() + interval '7 days'
    where match_id = p_match_id and status = 'active';
end;
$$;

create or replace function public.matchdeal_investor_still_interested(p_match_id uuid) returns void
language plpgsql security definer as $$
declare
  v_already_used boolean;
begin
  select used_still_interested_reset into v_already_used
  from public.matchdeal_responsibility_queue
  where match_id = p_match_id and status = 'active';

  if v_already_used then
    raise exception 'Este botão só pode ser usado uma vez por match — envia uma mensagem ou propõe uma reunião em vez disso.';
  end if;

  update public.matchdeal_responsibility_queue
    set sla_deadline = now() + interval '7 days', used_still_interested_reset = true
    where match_id = p_match_id and status = 'active';
end;
$$;

create or replace function public.matchdeal_startup_report_no_response(p_match_id uuid) returns void
language plpgsql security definer as $$
declare
  v_granted_at timestamptz;
begin
  select dataroom_granted_at into v_granted_at
  from public.matchdeal_matches
  where id = p_match_id;

  if v_granted_at is null then
    raise exception 'Ainda não há acesso ao data room concedido neste match.';
  end if;

  if now() < v_granted_at + interval '48 hours' then
    raise exception 'Só é possível reportar falta de resposta 48h depois da concessão de acesso.';
  end if;

  perform public.matchdeal_reassign_next(p_match_id);
end;
$$;

create or replace function public.matchdeal_startup_end_contact(p_match_id uuid, p_reason text default null::text, p_block_entity boolean default false) returns void
language plpgsql security definer as $$
declare
  v_match public.matchdeal_matches;
begin
  select * into v_match from public.matchdeal_matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'MATCHDEAL_MATCH_NOT_FOUND';
  end if;
  if v_match.status <> 'active' then
    raise exception 'MATCHDEAL_MATCH_NOT_ACTIVE';
  end if;

  -- 1. Revogar o data room ANTES de fechar o match: a função de revogação
  --    resolve o investidor por active_investor_profile_id, e esse campo tem
  --    de continuar preenchido enquanto ela corre.
  perform public.matchdeal_revoke_dataroom(p_match_id);

  -- 2. Fechar à entidade inteira, com o cooldown de 30 dias (igual à recusa
  --    inicial; o de 90 dias é outra coisa — é a fila esgotada por SLA).
  update public.matchdeal_matches
    set status = 'closed_by_startup',
        cooldown_until = now() + interval '30 days',
        updated_at = now()
    where id = p_match_id;

  -- 3. A fila inteira encerra. Nenhum 'waiting' passa a 'active'.
  update public.matchdeal_responsibility_queue
    set status = 'declined'
    where match_id = p_match_id and status in ('active', 'waiting');

  -- 4. Razão: registo interno, e só isso. Fica no payload do evento, que é
  --    a trilha de auditoria, e NUNCA é reexibida ao investidor seguinte —
  --    não há nenhum caminho de leitura dela para a UI do investidor.
  insert into public.matchdeal_match_events (match_id, event_type, payload)
  values (p_match_id, 'closed_by_startup',
          jsonb_build_object('reason', p_reason, 'blocked_entity', p_block_entity));

  -- 5. Aviso profissional, sem atribuir culpa.
  insert into public.matchdeal_messages (match_id, sender_profile_id, kind, body)
  values (p_match_id, null, 'system', 'The startup has ended this contact.');

  if v_match.active_investor_profile_id is not null then
    insert into public.matchdeal_notifications (profile_id, kind, body)
    values (v_match.active_investor_profile_id, 'contact_ended',
            'The startup has ended this contact.');
  end if;

  -- 6. Bloqueio opcional de longa duração, reversível pela startup.
  if p_block_entity then
    insert into public.matchdeal_entity_blocks (startup_profile_id, catalog_entity_id)
    values (v_match.startup_profile_id, v_match.investor_catalog_entity_id)
    on conflict do nothing;
  end if;
end; $$;

create or replace function public.matchdeal_confirm_meeting_overlap() returns trigger
language plpgsql security definer as $$
declare
  v_other record;
  v_common timestamptz;
begin
  -- Só faz sentido comparar propostas ainda por confirmar.
  if new.confirmed_slot is not null then
    return new;
  end if;

  for v_other in
    select id, proposed_slots
    from public.matchdeal_meeting_proposals
    where match_id = new.match_id
      and proposed_by_profile_id <> new.proposed_by_profile_id
      and confirmed_slot is null
    order by created_at asc
  loop
    select slot into v_common
    from unnest(new.proposed_slots) as slot
    where slot = any(v_other.proposed_slots)
    limit 1;

    if v_common is not null then
      update public.matchdeal_meeting_proposals
        set confirmed_slot = v_common
        where id = new.id;
      update public.matchdeal_meeting_proposals
        set confirmed_slot = v_common
        where id = v_other.id;

      insert into public.matchdeal_messages (match_id, sender_profile_id, kind, body)
      values (new.match_id, null, 'system',
        'Reunião confirmada para ' || to_char(v_common at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC — ambos os lados propuseram essa disponibilidade.');

      exit;
    end if;
  end loop;

  return new;
end;
$$;

-- Mecanismo de pareamento alternativo por RPC (ver observação #1 no topo).
create or replace function public.matchdeal_pairing_seal(p_pairing_token text) returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare
  v_membership uuid;
begin
  if auth.uid() is null then
    return false;
  end if;
  select ids into v_membership
    from public.matchdeal_current_membership_ids() as ids
   limit 1;
  if v_membership is null then
    return false;
  end if;
  update public.matchdeal_device_links
     set membership_id = v_membership,
         user_id = auth.uid(),
         used_at = now(),
         session_email = null,
         session_email_otp = null
   where pairing_token = p_pairing_token
     and membership_id is null;
  return found;
end;
$$;

create or replace function public.matchdeal_pairing_poll(p_pairing_token text) returns table(status text, session_email text, session_email_otp text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v public.matchdeal_device_links;
begin
  select * into v from public.matchdeal_device_links
   where pairing_token = p_pairing_token
   for update;
  if not found then
    return query select 'not_found'::text, null::text, null::text; return;
  end if;
  if v.membership_id is not null or v.used_at is not null then
    return query select 'sealed'::text, null::text, null::text; return;
  end if;
  if v.expires_at < now() then
    return query select 'expired'::text, null::text, null::text; return;
  end if;
  if v.session_email_otp is not null then
    update public.matchdeal_device_links
       set session_email_otp = null
     where id = v.id;
    return query select 'ready'::text, v.session_email, v.session_email_otp; return;
  end if;
  return query select 'pending'::text, null::text, null::text;
end;
$$;

-- ============================================================
-- 4. TRIGGERS
-- ============================================================

create or replace trigger trg_matchdeal_profile_completeness
  before insert or update on public.matchdeal_profiles
  for each row execute function public.matchdeal_recompute_profile_completeness();

create or replace trigger trg_matchdeal_confirm_meeting_overlap
  after insert on public.matchdeal_meeting_proposals
  for each row execute function public.matchdeal_confirm_meeting_overlap();

-- ============================================================
-- 5. VIEW
-- ============================================================

-- Bug fix (2026-08-06, migration 0135's own §5 finding) — this view was
-- created without `with (security_invoker = true)`, so it ran SECURITY
-- DEFINER by default: reads underlying tables as its owner (postgres, who
-- has rolbypassrls), bypassing RLS entirely. It was also left with
-- Supabase's default grants to anon/authenticated, so PostgREST served it
-- to anyone with the publishable key — a real, measured leak (5 swipes and
-- 86 exposures visible through the view that RLS shows as 0 to that same
-- caller directly). 0135 fixed this in production with a revoke (the
-- durable control) plus `alter view ... set (security_invoker = true)`
-- (mostly cosmetic once the revoke is in place, since the view's only
-- remaining readers — postgres, service_role — have rolbypassrls anyway;
-- it exists to make the advisor lint honest. Correction, 2026-08-06,
-- caught in verification: under `create or replace view` it is the
-- REVOKE that survives and the security_invoker option that gets erased —
-- see the measured finding two paragraphs below. The scenario where the
-- source clause is the thing that matters is `drop view` + recreate, which
-- resets the ACL back to Supabase's public-schema defaults — re-exposing
-- anon/authenticated — and would need the `with` clause present at
-- creation to avoid also reopening the DEFINER behavior at the same time).
--
-- Why the clause is added HERE, on the already-applied 0053, rather than
-- left to 0135 alone: `alter view ... set (security_invoker)` is fragile —
-- confirmed empirically that a bare `create or replace view` (no `with`
-- clause) silently clears it while leaving the revoke's ACL intact. A
-- schema rebuilt from these migrations from scratch must get the correct
-- clause the first time, at the point the view is actually defined, not
-- rely on a later migration to re-apply what a replay of this one would
-- have already erased. This edit changes what a FROM-SCRATCH REPLAY
-- produces; it does not re-run anything in production, where the option is
-- already set (by 0135).
create or replace view public.matchdeal_startup_hype
  with (security_invoker = true) as
with w as (
  select * from public.matchdeal_hype_weights()
), week as (
  select public.matchdeal_current_week_start() as start
), base as (
  select p.id as startup_profile_id,
    (select count(*) from public.matchdeal_swipes s
      where s.target_profile_id = p.id and s.direction = 'like' and s.created_at >= (select week.start from week))::numeric as likes_week,
    (select count(*) from public.matchdeal_swipes s
      where s.target_profile_id = p.id and s.direction = 'like'
        and s.created_at >= ((select week.start from week) - interval '7 days')
        and s.created_at < (select week.start from week))::numeric as likes_prev,
    (select count(*) from public.matchdeal_exposures e
      where e.shown_profile_id = p.id and e.shown_at >= (select week.start from week))::numeric as shown_week,
    (select count(*) from public.matchdeal_boosts b
      where b.boosted_profile_id = p.id and b.week_start = (select week.start from week))::numeric as super_likes_week,
    case when p.is_complete then 1.0 else 0.0 end as completeness
  from public.matchdeal_profiles p
  where p.kind = 'startup' and p.is_visible = true
), scaled as (
  select b.startup_profile_id, b.likes_week, b.likes_prev, b.shown_week, b.super_likes_week, b.completeness,
    b.likes_week / nullif((select max(base.likes_week) from base), 0) as n_likes,
    b.super_likes_week / nullif((select max(base.super_likes_week) from base), 0) as n_super,
    case
      when b.likes_prev = 0 and b.likes_week = 0 then 0
      when b.likes_prev = 0 then 1
      else least(b.likes_week / b.likes_prev, 3) / 3
    end as n_growth,
    case when b.shown_week = 0 then 0 else b.likes_week / b.shown_week end as approval_rate
  from base b
), scored as (
  select s.startup_profile_id,
    (coalesce(s.n_likes, 0) * (select w.w_likes_week from w)
     + coalesce(s.n_growth, 0) * (select w.w_growth from w)
     + s.approval_rate * (select w.w_approval_rate from w)
     + (case when s.completeness >= (select w.completeness_min from w) then 1 else 0 end) * (select w.w_completeness from w)
     + coalesce(s.n_super, 0) * (select w.w_super_likes from w))
    / ((select w.w_likes_week from w) + (select w.w_growth from w) + (select w.w_approval_rate from w) + (select w.w_completeness from w) + (select w.w_super_likes from w))
    as score
  from scaled s
)
select startup_profile_id, score >= (select w.hype_threshold from w) as is_hype
from scored;

-- ============================================================
-- 6. RLS — enable + policies (drop-then-create per policy for idempotency;
--    ENABLE ROW LEVEL SECURITY is naturally idempotent)
-- ============================================================

alter table public.matchdeal_flags enable row level security;
alter table public.matchdeal_investor_members enable row level security;
alter table public.matchdeal_profiles enable row level security;
alter table public.matchdeal_device_links enable row level security;
alter table public.matchdeal_swipes enable row level security;
alter table public.matchdeal_exposures enable row level security;
alter table public.matchdeal_entity_blocks enable row level security;
alter table public.matchdeal_matches enable row level security;
alter table public.matchdeal_responsibility_queue enable row level security;
alter table public.matchdeal_dataroom_consent enable row level security;
alter table public.matchdeal_match_events enable row level security;
alter table public.matchdeal_messages enable row level security;
alter table public.matchdeal_meeting_proposals enable row level security;
alter table public.matchdeal_notifications enable row level security;
alter table public.matchdeal_weekly_activity enable row level security;
alter table public.matchdeal_boosts enable row level security;

drop policy if exists matchdeal_flags_admin_write on public.matchdeal_flags;
create policy matchdeal_flags_admin_write on public.matchdeal_flags for all
  using (is_platform_admin()) with check (is_platform_admin());
drop policy if exists matchdeal_flags_read on public.matchdeal_flags;
create policy matchdeal_flags_read on public.matchdeal_flags for select
  using (auth.uid() is not null);

drop policy if exists matchdeal_investor_members_select_own on public.matchdeal_investor_members;
create policy matchdeal_investor_members_select_own on public.matchdeal_investor_members for select
  using (user_id = auth.uid());

drop policy if exists matchdeal_profiles_select_visible on public.matchdeal_profiles;
create policy matchdeal_profiles_select_visible on public.matchdeal_profiles for select
  using (is_visible = true or membership_id in (select public.matchdeal_current_membership_ids()));
drop policy if exists matchdeal_profiles_write_own on public.matchdeal_profiles;
create policy matchdeal_profiles_write_own on public.matchdeal_profiles for all
  using (membership_id in (select public.matchdeal_current_membership_ids()))
  with check (
    (kind = 'startup' and membership_id in (select org_members.org_id from public.org_members where org_members.user_id = auth.uid()))
    or (kind = 'investor' and membership_id in (select matchdeal_investor_members.id from public.matchdeal_investor_members where matchdeal_investor_members.user_id = auth.uid()))
  );

drop policy if exists matchdeal_device_links_insert on public.matchdeal_device_links;
create policy matchdeal_device_links_insert on public.matchdeal_device_links for insert
  with check (true);
drop policy if exists matchdeal_device_links_select_own on public.matchdeal_device_links;
create policy matchdeal_device_links_select_own on public.matchdeal_device_links for select
  using (membership_id in (select public.matchdeal_current_membership_ids()));
drop policy if exists matchdeal_device_links_update_own on public.matchdeal_device_links;
create policy matchdeal_device_links_update_own on public.matchdeal_device_links for update
  using (membership_id in (select public.matchdeal_current_membership_ids()));

drop policy if exists matchdeal_swipes_own on public.matchdeal_swipes;
create policy matchdeal_swipes_own on public.matchdeal_swipes for all
  using (actor_profile_id in (select public.matchdeal_current_profile_ids()))
  with check (actor_profile_id in (select public.matchdeal_current_profile_ids()));

drop policy if exists matchdeal_exposures_own on public.matchdeal_exposures;
create policy matchdeal_exposures_own on public.matchdeal_exposures for all
  using (viewer_profile_id in (select public.matchdeal_current_profile_ids()))
  with check (viewer_profile_id in (select public.matchdeal_current_profile_ids()));

drop policy if exists matchdeal_entity_blocks_own on public.matchdeal_entity_blocks;
create policy matchdeal_entity_blocks_own on public.matchdeal_entity_blocks for all
  using (startup_profile_id in (select public.matchdeal_current_profile_ids()))
  with check (startup_profile_id in (select public.matchdeal_current_profile_ids()));

drop policy if exists matchdeal_matches_participants on public.matchdeal_matches;
create policy matchdeal_matches_participants on public.matchdeal_matches for select
  using (
    startup_profile_id in (select public.matchdeal_current_profile_ids())
    or id in (select matchdeal_responsibility_queue.match_id from public.matchdeal_responsibility_queue
              where matchdeal_responsibility_queue.investor_profile_id in (select public.matchdeal_current_profile_ids()))
  );

drop policy if exists matchdeal_queue_participants on public.matchdeal_responsibility_queue;
create policy matchdeal_queue_participants on public.matchdeal_responsibility_queue for select
  using (
    investor_profile_id in (select public.matchdeal_current_profile_ids())
    or match_id in (select matchdeal_matches.id from public.matchdeal_matches
                    where matchdeal_matches.startup_profile_id in (select public.matchdeal_current_profile_ids()))
  );

drop policy if exists matchdeal_consent_participants on public.matchdeal_dataroom_consent;
create policy matchdeal_consent_participants on public.matchdeal_dataroom_consent for select
  using (
    match_id in (
      select m.id from public.matchdeal_matches m
      where m.startup_profile_id in (select public.matchdeal_current_profile_ids())
         or m.id in (select matchdeal_responsibility_queue.match_id from public.matchdeal_responsibility_queue
                     where matchdeal_responsibility_queue.investor_profile_id in (select public.matchdeal_current_profile_ids()))
    )
  );
drop policy if exists matchdeal_consent_startup_writes on public.matchdeal_dataroom_consent;
create policy matchdeal_consent_startup_writes on public.matchdeal_dataroom_consent for insert
  with check (
    match_id in (select matchdeal_matches.id from public.matchdeal_matches
                where matchdeal_matches.startup_profile_id in (select public.matchdeal_current_profile_ids()))
  );

drop policy if exists matchdeal_match_events_participants on public.matchdeal_match_events;
create policy matchdeal_match_events_participants on public.matchdeal_match_events for select
  using (
    match_id in (
      select m.id from public.matchdeal_matches m
      where m.startup_profile_id in (select public.matchdeal_current_profile_ids())
         or m.id in (select matchdeal_responsibility_queue.match_id from public.matchdeal_responsibility_queue
                     where matchdeal_responsibility_queue.investor_profile_id in (select public.matchdeal_current_profile_ids()))
    )
  );

drop policy if exists matchdeal_messages_participants on public.matchdeal_messages;
create policy matchdeal_messages_participants on public.matchdeal_messages for select
  using (
    match_id in (select m.id from public.matchdeal_matches m
                where m.startup_profile_id in (select public.matchdeal_current_profile_ids())
                   or m.active_investor_profile_id in (select public.matchdeal_current_profile_ids()))
  );
drop policy if exists matchdeal_messages_insert_active_participants on public.matchdeal_messages;
create policy matchdeal_messages_insert_active_participants on public.matchdeal_messages for insert
  with check (
    sender_profile_id in (select public.matchdeal_current_profile_ids())
    and match_id in (
      select m.id from public.matchdeal_matches m
      where m.status = 'active'
        and (m.startup_profile_id in (select public.matchdeal_current_profile_ids())
             or m.active_investor_profile_id in (select public.matchdeal_current_profile_ids()))
    )
  );

drop policy if exists matchdeal_meetings_participants on public.matchdeal_meeting_proposals;
create policy matchdeal_meetings_participants on public.matchdeal_meeting_proposals for all
  using (
    match_id in (select m.id from public.matchdeal_matches m
                where m.startup_profile_id in (select public.matchdeal_current_profile_ids())
                   or m.active_investor_profile_id in (select public.matchdeal_current_profile_ids()))
  )
  with check (proposed_by_profile_id in (select public.matchdeal_current_profile_ids()));

drop policy if exists matchdeal_notifications_own on public.matchdeal_notifications;
create policy matchdeal_notifications_own on public.matchdeal_notifications for select
  using (profile_id in (select public.matchdeal_current_profile_ids()));
drop policy if exists matchdeal_notifications_mark_read on public.matchdeal_notifications;
create policy matchdeal_notifications_mark_read on public.matchdeal_notifications for update
  using (profile_id in (select public.matchdeal_current_profile_ids()))
  with check (profile_id in (select public.matchdeal_current_profile_ids()));

drop policy if exists matchdeal_weekly_activity_own on public.matchdeal_weekly_activity;
create policy matchdeal_weekly_activity_own on public.matchdeal_weekly_activity for select
  using (profile_id in (select public.matchdeal_current_profile_ids()));

drop policy if exists matchdeal_boosts_participants on public.matchdeal_boosts;
create policy matchdeal_boosts_participants on public.matchdeal_boosts for select
  using (
    investor_profile_id in (select public.matchdeal_current_profile_ids())
    or boosted_profile_id in (select public.matchdeal_current_profile_ids())
  );

-- ============================================================
-- 7. pg_cron — sla sweep every 15 minutes
-- ============================================================
-- cron.schedule() upserts by jobname (pg_cron >= 1.4) — safe to re-run.
-- Requires the pg_cron extension to already be enabled on the target
-- database (Supabase: Database > Extensions, or superuser-run
-- `create extension if not exists pg_cron;`). Not created here
-- automatically — extension creation needs a privilege level this
-- migration-runner role may not have on every environment, and silently
-- failing that statement would abort the whole file. If cron.schedule()
-- below errors with "schema cron does not exist," enable the extension
-- first and re-run just this section.
select cron.schedule(
  'matchdeal_sla_sweep',
  '*/15 * * * *',
  $$select public.matchdeal_sweep_sla_timeouts();$$
);
