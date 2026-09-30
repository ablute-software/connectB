-- Prompt I-01 (+ I-01a) — Incubadoras, Fase 1: fundações.
--
-- NOT applied to any live database by the session that wrote it. Apply only
-- with Nuno's explicit "sim" (I-01 §F.2), via apply_migration, and rename
-- this file afterwards to the version apply_migration actually records (see
-- the "migration ledger: name vs version" note in DECISIONS.md, Prompt 898).
--
-- Concept: docs/incubadoras/v4-conceito-decisoes-20260930.md (D2, D2b, D3,
-- D4, D6, D6b, D19). Map: docs/incubadoras/I-00-mapa-20260930.md.
--
-- Shape of the boundary, decided in I-00/I-01a and not to be undone here:
--   * An incubator is NOT a row in `orgs`, and its people are NOT rows in
--     `org_members` (I-00 map, "Contradições" §1): an org_members row would
--     resolve the manager as a founder, a founder with two memberships breaks
--     128 `maybeSingle()` call sites, and every `orgs` insert fires
--     network_actor_for_new_org. Nothing in this file writes to `orgs`,
--     `org_members`, `access_grants`, `entities`, `interactions`,
--     `deal_terms` or `documents`, and no trigger here touches them.
--   * Never an `access_grants` row for an incubator user (I-00 C.6).
--   * The incubator reads NOTHING of the startup's content in this migration.
--     The single definition of "may see level N of org X" is
--     incubator_can_view(); no policy on a founder table uses it yet (I-03).
--   * Every state change the RLS layer cannot express as "these columns only"
--     goes through a SECURITY DEFINER function that checks the caller itself.
--   * Grants are explicit on every table (DECISIONS.md 25/09/2026 / Prompt
--     898 §B): nothing for public/anon; `authenticated` gets only what the
--     policies below are meant to allow. service_role keeps everything.

-- ===========================================================================
-- A.1 incubators
create table if not exists public.incubators (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind text not null default 'other' check (kind in (
    'municipal', 'university', 'private_accelerator', 'corporate', 'pre_incubation', 'other'
  )),
  legal_name text,
  vat_id text,
  website text,
  country text,
  city text,
  logo_url text,
  description text,
  -- D3 — the investing arm of the same house, if any. Used ONLY to show the
  -- founder the "this organisation also invests" notice; the platform never
  -- joins incubator data to investor data through this column.
  related_catalog_entity_id uuid references public.catalog_entities(id) on delete set null,
  is_test boolean not null default false,
  is_internal boolean not null default false,
  stripe_customer_id text,
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.incubators is
  'Prompt I-01 — an incubator/accelerator organisation. Deliberately not a row in orgs (see migration header).';

-- A.2 incubator_members
create table if not exists public.incubator_members (
  id uuid primary key default gen_random_uuid(),
  incubator_id uuid not null references public.incubators(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  invited_email text check (invited_email is null or invited_email = lower(btrim(invited_email))),
  role text not null default 'manager' check (role in ('owner', 'manager')),
  full_name text,
  title text,
  status text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  -- sha256 hex of the raw invite token (same scheme as guest-token-server.ts /
  -- matchdeal-pairing.ts hashToken). The raw token is never stored.
  invite_token_hash text unique,
  invite_expires_at timestamptz,
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incubator_members_active_has_user check (status <> 'active' or user_id is not null),
  constraint incubator_members_identity check (user_id is not null or invited_email is not null)
);
create unique index if not exists incubator_members_user_uidx
  on public.incubator_members (incubator_id, user_id) where user_id is not null;
create unique index if not exists incubator_members_invited_email_uidx
  on public.incubator_members (incubator_id, lower(invited_email)) where status = 'invited';
create index if not exists incubator_members_user_idx on public.incubator_members (user_id) where status = 'active';
comment on table public.incubator_members is
  'Prompt I-01 — people who work an incubator workspace. Never org_members rows, never access_grants rows.';

-- A.3 incubator_cohorts
create table if not exists public.incubator_cohorts (
  id uuid primary key default gen_random_uuid(),
  incubator_id uuid not null references public.incubators(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  starts_on date,
  ends_on date,
  -- "Every startup accepted into this cohort gets voucher X". The column
  -- exists now; applying it automatically is I-02, and until I-02 gives
  -- promo_codes an owner the policies below keep it null.
  auto_promo_code_id uuid references public.promo_codes(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incubator_cohorts_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists incubator_cohorts_incubator_idx on public.incubator_cohorts (incubator_id);
comment on table public.incubator_cohorts is
  'Prompt I-01 — cohorts (turmas). Own table in Phase 1; the bridge to network_groups(accelerator_batch) is Phase 3.';

-- A.4 incubator_invites (the "stub" of v4 §9.2: startup_name/sector/website
-- prefill the signup of someone who has no account yet)
create table if not exists public.incubator_invites (
  id uuid primary key default gen_random_uuid(),
  incubator_id uuid not null references public.incubators(id) on delete cascade,
  cohort_id uuid references public.incubator_cohorts(id) on delete set null,
  email text not null check (email = lower(btrim(email)) and email like '%@%'),
  startup_name text,
  sector text,
  website text,
  note text,
  promo_code_id uuid references public.promo_codes(id) on delete set null,
  invited_by uuid references public.incubator_members(id) on delete set null,
  token_hash text not null unique,
  token_expires_at timestamptz not null default (now() + interval '30 days'),
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined', 'expired', 'revoked')),
  accepted_org_id uuid references public.orgs(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  declined_at timestamptz,
  revoked_at timestamptz,
  sent_at timestamptz,
  last_sent_at timestamptz,
  send_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists incubator_invites_pending_uidx
  on public.incubator_invites (incubator_id, email) where status = 'invited';
create index if not exists incubator_invites_incubator_idx on public.incubator_invites (incubator_id, created_at desc);
comment on table public.incubator_invites is
  'Prompt I-01 — invitation of a startup into an incubator. Links nothing until the founder accepts (v4 principle 2).';

-- A.5 incubator_relationships
create table if not exists public.incubator_relationships (
  id uuid primary key default gen_random_uuid(),
  incubator_id uuid not null references public.incubators(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  cohort_id uuid references public.incubator_cohorts(id) on delete set null,
  invite_id uuid references public.incubator_invites(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused', 'graduated', 'ended')),
  -- D2 — level 1 · Perfil by default. The model is 0–4; the RPC below only
  -- lets the founder choose 0–2 until Phase 2 (refinement of D19).
  sharing_level smallint not null default 1 check (sharing_level between 0 and 4),
  -- D4 — "visible on my public profile", per relationship, default on.
  public_badge boolean not null default true,
  manager_member_id uuid references public.incubator_members(id) on delete set null,
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  graduated_at timestamptz,
  ended_at timestamptz,
  ended_by text check (ended_by in ('founder', 'incubator', 'platform')),
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incubator_relationships_ended_shape check (
    (status = 'ended') = (ended_at is not null and ended_by is not null)
  )
);
-- One live relationship per pair; a new invite after 'ended' creates a new
-- row and the history stays.
create unique index if not exists incubator_relationships_live_uidx
  on public.incubator_relationships (incubator_id, org_id) where status <> 'ended';
create index if not exists incubator_relationships_org_idx on public.incubator_relationships (org_id);
comment on table public.incubator_relationships is
  'Prompt I-01 — incubator ↔ startup. active/graduated give live access at sharing_level; paused/ended give none (D6: no grace period).';

-- A.6 incubator_access_log
create table if not exists public.incubator_access_log (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.incubator_relationships(id) on delete cascade,
  member_id uuid references public.incubator_members(id) on delete set null,
  surface text not null check (surface in (
    'dossier_profile', 'dossier_facts', 'dossier_roadmap', 'dossier_readiness',
    'dossier_documents', 'dossier_round', 'declaration', 'report'
  )),
  target_id uuid,
  viewed_at timestamptz not null default now()
);
create index if not exists incubator_access_log_rel_idx on public.incubator_access_log (relationship_id, viewed_at desc);
comment on table public.incubator_access_log is
  'Prompt I-01 — every content consultation by an incubator member (v4 principle 4). Insert only through incubator_log_access().';

-- updated_at bookkeeping
create or replace function public.incubators_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists incubators_touch on public.incubators;
create trigger incubators_touch before update on public.incubators
  for each row execute function public.incubators_touch_updated_at();
drop trigger if exists incubator_members_touch on public.incubator_members;
create trigger incubator_members_touch before update on public.incubator_members
  for each row execute function public.incubators_touch_updated_at();
drop trigger if exists incubator_cohorts_touch on public.incubator_cohorts;
create trigger incubator_cohorts_touch before update on public.incubator_cohorts
  for each row execute function public.incubators_touch_updated_at();
drop trigger if exists incubator_invites_touch on public.incubator_invites;
create trigger incubator_invites_touch before update on public.incubator_invites
  for each row execute function public.incubators_touch_updated_at();

-- A.5 semantics that must hold no matter which function writes the row:
-- D6b — graduating drops the level to 1 if it was above (the founder may
-- raise it again afterwards; this only fires on the transition itself).
create or replace function public.incubator_relationships_before_update()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'graduated' and old.status is distinct from 'graduated' then
    new.graduated_at := coalesce(new.graduated_at, now());
    if new.sharing_level > 1 then
      new.sharing_level := 1;
    end if;
  end if;
  if new.status = 'paused' and old.status is distinct from 'paused' then
    new.paused_at := now();
  end if;
  if old.status = 'ended' and new.status <> 'ended' then
    raise exception 'an ended relationship cannot be reopened; invite again instead';
  end if;
  return new;
end $$;
drop trigger if exists incubator_relationships_before_update on public.incubator_relationships;
create trigger incubator_relationships_before_update before update on public.incubator_relationships
  for each row execute function public.incubator_relationships_before_update();

-- ===========================================================================
-- A.7 Helpers — the single definitions of "member", "owner", "may see".
create or replace function public.is_incubator_member(p_incubator_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from incubator_members m
    join incubators i on i.id = m.incubator_id
    where m.incubator_id = p_incubator_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and i.closed_at is null
  );
$$;

create or replace function public.is_incubator_owner(p_incubator_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from incubator_members m
    join incubators i on i.id = m.incubator_id
    where m.incubator_id = p_incubator_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'owner'
      and i.closed_at is null
  );
$$;

-- The role signal (resolveRole AND middleware.ts call this one function, so
-- "is this user an incubator person" has exactly one definition).
create or replace function public.has_active_incubator_membership()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from incubator_members m
    join incubators i on i.id = m.incubator_id
    where m.user_id = auth.uid() and m.status = 'active' and i.closed_at is null
  );
$$;

-- "May the caller, as an incubator member, see level p_level of org p_org_id?"
-- active and graduated give live access at the shared level; paused and
-- ended give none, from the instant the status changes (D6).
create or replace function public.incubator_can_view(p_org_id uuid, p_level smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from incubator_relationships r
    where r.org_id = p_org_id
      and r.status in ('active', 'graduated')
      and r.sharing_level >= p_level
      and public.is_incubator_member(r.incubator_id)
  );
$$;

-- The caller's own active member row in one incubator (null if none).
create or replace function public.incubator_my_member_id(p_incubator_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.id
  from incubator_members m
  join incubators i on i.id = m.incubator_id
  where m.incubator_id = p_incubator_id and m.user_id = auth.uid()
    and m.status = 'active' and i.closed_at is null
  limit 1;
$$;

-- The caller's one open founder org, the same "one org per user" reading
-- resolveRole makes (supabase-server.ts). Two open orgs → null, never a guess.
create or replace function public.incubator_caller_open_org()
returns uuid language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then min(om.org_id::text)::uuid end
  from org_members om
  join orgs o on o.id = om.org_id
  where om.user_id = auth.uid() and o.closed_at is null;
$$;

-- Prompt I-01b §B — the founder-side actions (accept/decline an invite,
-- change the sharing level or the badge, end the relationship) belong to the
-- org's owners and admins, the same people as manage_org_settings
-- (src/lib/permissions.ts, capability manage_programs). Reading stays open to
-- every member of the org.
create or replace function public.incubator_caller_org_can_manage(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members om
    where om.org_id = p_org_id and om.user_id = auth.uid() and om.role::text in ('owner', 'admin')
  );
$$;

-- Prompt I-01b §A — "n…@startup.pt": enough for the invitee to recognise the
-- address, not enough to hand a forwarded link's reader someone's e-mail.
create or replace function public.incubator_mask_email(p_email text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else left(split_part(p_email, '@', 1), 2) || '…@' || split_part(p_email, '@', 2)
  end;
$$;

-- ===========================================================================
-- A.8 State transitions. Business errors come back as {ok:false, error:<code>}
-- rather than as exceptions, so a status write that accompanies a refusal
-- (e.g. marking an invite 'expired') is not rolled back with it.

-- Accept a startup invite, for the caller's own open org.
create or replace function public.incubator_accept_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  v_inv incubator_invites%rowtype;
  v_org uuid;
  v_rel incubator_relationships%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  select * into v_inv from incubator_invites where token_hash = v_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invite_not_found');
  end if;
  -- Prompt I-01b §A — only the invited address can accept: a forwarded link
  -- must not attach someone else's startup to the portfolio (nor, from I-02
  -- on, hand it the voucher). Checked before any write.
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> lower(v_inv.email) then
    return jsonb_build_object('ok', false, 'error', 'invite_email_mismatch',
      'invited_email_masked', public.incubator_mask_email(v_inv.email));
  end if;
  if exists (select 1 from incubators where id = v_inv.incubator_id and closed_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'incubator_closed');
  end if;
  v_org := public.incubator_caller_open_org();
  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'no_open_org');
  end if;
  -- Prompt I-01b §B — owners and admins only.
  if not public.incubator_caller_org_can_manage(v_org) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  -- Idempotent: the same org accepting the same invite again gets the
  -- relationship it already has.
  if v_inv.status = 'accepted' then
    if v_inv.accepted_org_id = v_org then
      select * into v_rel from incubator_relationships
        where incubator_id = v_inv.incubator_id and org_id = v_org and status <> 'ended'
        order by started_at desc limit 1;
      if found then
        return jsonb_build_object('ok', true, 'already', true, 'relationship_id', v_rel.id,
          'promo_code_id', null, 'incubator_id', v_inv.incubator_id, 'org_id', v_org);
      end if;
    end if;
    return jsonb_build_object('ok', false, 'error', 'invite_already_accepted');
  end if;
  if v_inv.status <> 'invited' then
    return jsonb_build_object('ok', false, 'error', 'invite_' || v_inv.status);
  end if;
  if v_inv.token_expires_at < now() then
    update incubator_invites set status = 'expired' where id = v_inv.id;
    return jsonb_build_object('ok', false, 'error', 'invite_expired');
  end if;

  -- A live relationship with this incubator already exists (e.g. a second
  -- invite): keep it, mark this invite accepted, do not create a duplicate.
  select * into v_rel from incubator_relationships
    where incubator_id = v_inv.incubator_id and org_id = v_org and status <> 'ended';
  if found then
    update incubator_invites
      set status = 'accepted', accepted_org_id = v_org, accepted_by = auth.uid(), accepted_at = now()
      where id = v_inv.id;
    return jsonb_build_object('ok', true, 'already', true, 'relationship_id', v_rel.id,
      'promo_code_id', null, 'incubator_id', v_inv.incubator_id, 'org_id', v_org);
  end if;

  insert into incubator_relationships (incubator_id, org_id, cohort_id, invite_id, status, sharing_level, public_badge)
    values (v_inv.incubator_id, v_org, v_inv.cohort_id, v_inv.id, 'active', 1, true)
    returning * into v_rel;
  update incubator_invites
    set status = 'accepted', accepted_org_id = v_org, accepted_by = auth.uid(), accepted_at = now()
    where id = v_inv.id;
  -- The voucher (if any) is redeemed by the calling route through the same
  -- rules as /api/promo/redeem; a failed redemption never undoes this.
  return jsonb_build_object('ok', true, 'already', false, 'relationship_id', v_rel.id,
    'promo_code_id', v_inv.promo_code_id, 'incubator_id', v_inv.incubator_id, 'org_id', v_org);
end $$;

-- Decline. Prompt I-01b §A — the same address check as accept, so a
-- forwarded link cannot decline on the invitee's behalf either. Signed in;
-- if the caller already runs an org, declining is an owner/admin act there
-- too (§B); someone with no org yet declines for themselves.
create or replace function public.incubator_decline_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  v_inv incubator_invites%rowtype;
  v_org uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  select * into v_inv from incubator_invites where token_hash = v_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invite_not_found');
  end if;
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> lower(v_inv.email) then
    return jsonb_build_object('ok', false, 'error', 'invite_email_mismatch',
      'invited_email_masked', public.incubator_mask_email(v_inv.email));
  end if;
  v_org := public.incubator_caller_open_org();
  if v_org is not null and not public.incubator_caller_org_can_manage(v_org) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_inv.status = 'declined' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_inv.status <> 'invited' then
    return jsonb_build_object('ok', false, 'error', 'invite_' || v_inv.status);
  end if;
  update incubator_invites set status = 'declined', declined_at = now() where id = v_inv.id;
  return jsonb_build_object('ok', true, 'already', false, 'incubator_id', v_inv.incubator_id);
end $$;

-- Founder owner/admin only (I-01b §B). 0–2 in Phase 1; 3–4 exist in the model and are refused here.
create or replace function public.incubator_set_sharing_level(p_relationship_id uuid, p_level smallint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rel incubator_relationships%rowtype;
begin
  select * into v_rel from incubator_relationships where id = p_relationship_id for update;
  if not found or not public.incubator_caller_org_can_manage(v_rel.org_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_rel.status = 'ended' then
    return jsonb_build_object('ok', false, 'error', 'relationship_ended');
  end if;
  if p_level is null or p_level < 0 or p_level > 4 then
    return jsonb_build_object('ok', false, 'error', 'invalid_level');
  end if;
  if p_level > 2 then
    return jsonb_build_object('ok', false, 'error', 'level_coming_soon');
  end if;
  update incubator_relationships set sharing_level = p_level where id = v_rel.id;
  return jsonb_build_object('ok', true, 'sharing_level', p_level);
end $$;

create or replace function public.incubator_set_public_badge(p_relationship_id uuid, p_value boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rel incubator_relationships%rowtype;
begin
  select * into v_rel from incubator_relationships where id = p_relationship_id for update;
  if not found or not public.incubator_caller_org_can_manage(v_rel.org_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_rel.status = 'ended' then
    return jsonb_build_object('ok', false, 'error', 'relationship_ended');
  end if;
  update incubator_relationships set public_badge = coalesce(p_value, true) where id = v_rel.id;
  return jsonb_build_object('ok', true, 'public_badge', coalesce(p_value, true));
end $$;

-- Either side, any time. Founder side = the org's owners/admins (I-01b §B);
-- reason optional. Incubator: reason
-- required (the founder sees it). Immediate — incubator_can_view() is false
-- from this statement on (D6).
create or replace function public.incubator_end_relationship(p_relationship_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rel incubator_relationships%rowtype;
  v_by text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_rel from incubator_relationships where id = p_relationship_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if public.incubator_caller_org_can_manage(v_rel.org_id) then
    v_by := 'founder';
  elsif public.is_incubator_member(v_rel.incubator_id) then
    v_by := 'incubator';
    if v_reason is null then
      return jsonb_build_object('ok', false, 'error', 'reason_required');
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_rel.status = 'ended' then
    return jsonb_build_object('ok', true, 'already', true, 'ended_by', v_rel.ended_by,
      'org_id', v_rel.org_id, 'incubator_id', v_rel.incubator_id);
  end if;
  update incubator_relationships
    set status = 'ended', ended_at = now(), ended_by = v_by, end_reason = v_reason
    where id = v_rel.id;
  return jsonb_build_object('ok', true, 'already', false, 'ended_by', v_by, 'reason', v_reason,
    'org_id', v_rel.org_id, 'incubator_id', v_rel.incubator_id);
end $$;

-- Incubator only: active ⇄ paused, active → graduated. Never to or from
-- 'ended' (that is incubator_end_relationship, and ended is final).
create or replace function public.incubator_set_status(p_relationship_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rel incubator_relationships%rowtype;
begin
  select * into v_rel from incubator_relationships where id = p_relationship_id for update;
  if not found or not public.is_incubator_member(v_rel.incubator_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if not (
    (v_rel.status = 'active' and p_status in ('paused', 'graduated'))
    or (v_rel.status = 'paused' and p_status = 'active')
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition');
  end if;
  update incubator_relationships set status = p_status where id = v_rel.id
    returning * into v_rel;
  return jsonb_build_object('ok', true, 'status', v_rel.status, 'sharing_level', v_rel.sharing_level);
end $$;

-- Only an active member of that relationship's incubator, and only while the
-- relationship gives live access (a consultation cannot happen otherwise).
create or replace function public.incubator_log_access(p_relationship_id uuid, p_surface text, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rel incubator_relationships%rowtype;
  v_member uuid;
begin
  select * into v_rel from incubator_relationships where id = p_relationship_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  v_member := public.incubator_my_member_id(v_rel.incubator_id);
  if v_member is null or v_rel.status not in ('active', 'graduated') then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  insert into incubator_access_log (relationship_id, member_id, surface, target_id)
    values (v_rel.id, v_member, p_surface, p_target_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.incubator_revoke_invite(p_invite_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv incubator_invites%rowtype;
begin
  select * into v_inv from incubator_invites where id = p_invite_id for update;
  if not found or not public.is_incubator_member(v_inv.incubator_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_inv.status not in ('invited', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'invite_' || v_inv.status);
  end if;
  update incubator_invites set status = 'revoked', revoked_at = now() where id = v_inv.id;
  return jsonb_build_object('ok', true);
end $$;

-- Regenerates the token: the route mints the raw token and passes only its
-- hash (the raw value never reaches the database), so the old link dies.
create or replace function public.incubator_resend_invite(p_invite_id uuid, p_new_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv incubator_invites%rowtype;
begin
  select * into v_inv from incubator_invites where id = p_invite_id for update;
  if not found or not public.is_incubator_member(v_inv.incubator_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_inv.status not in ('invited', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'invite_' || v_inv.status);
  end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  update incubator_invites
    set token_hash = p_new_token_hash, token_expires_at = now() + interval '30 days',
        status = 'invited', last_sent_at = now(), send_count = send_count + 1
    where id = v_inv.id;
  return jsonb_build_object('ok', true, 'email', v_inv.email);
end $$;

-- Team management inside the workspace — owner only (C.3 "só owner").
create or replace function public.incubator_invite_member(
  p_incubator_id uuid, p_email text, p_role text, p_full_name text, p_token_hash text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  if not public.is_incubator_owner(p_incubator_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  if p_role not in ('owner', 'manager') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  if exists (
    select 1 from incubator_members m
    left join auth.users u on u.id = m.user_id
    where m.incubator_id = p_incubator_id and m.status = 'active' and lower(u.email) = v_email
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;
  -- Re-inviting the same pending address refreshes the pending row.
  update incubator_members
    set role = p_role, full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
        invite_token_hash = p_token_hash, invite_expires_at = now() + interval '14 days', invited_by = auth.uid()
    where incubator_id = p_incubator_id and status = 'invited' and invited_email = v_email
    returning id into v_id;
  if v_id is null then
    insert into incubator_members (incubator_id, invited_email, role, full_name, status, invite_token_hash, invite_expires_at, invited_by)
      values (p_incubator_id, v_email, p_role, nullif(btrim(p_full_name), ''), 'invited', p_token_hash, now() + interval '14 days', auth.uid())
      returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'member_id', v_id);
end $$;

-- The invited person accepts with their own session; the address must match
-- (same rule as api/invite/[token]/accept for founder team invites).
create or replace function public.incubator_accept_member_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  v_m incubator_members%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  select * into v_m from incubator_members where invite_token_hash = v_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invite_not_found');
  end if;
  if v_m.status <> 'invited' then
    return jsonb_build_object('ok', false, 'error', 'invite_' || v_m.status);
  end if;
  if v_m.invite_expires_at is not null and v_m.invite_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'invite_expired');
  end if;
  if v_email is distinct from v_m.invited_email then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;
  if exists (select 1 from incubators where id = v_m.incubator_id and closed_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'incubator_closed');
  end if;
  -- Already a member of this incubator under another row (e.g. re-invited
  -- after removal): reactivate that row instead of tripping the unique index.
  if exists (select 1 from incubator_members where incubator_id = v_m.incubator_id and user_id = auth.uid() and id <> v_m.id) then
    update incubator_members
      set status = 'active', role = v_m.role, accepted_at = now(), removed_at = null,
          full_name = coalesce(full_name, v_m.full_name)
      where incubator_id = v_m.incubator_id and user_id = auth.uid() and id <> v_m.id;
    update incubator_members set status = 'removed', removed_at = now(), invite_token_hash = null where id = v_m.id;
  else
    update incubator_members
      set user_id = auth.uid(), status = 'active', accepted_at = now(), invite_token_hash = null
      where id = v_m.id;
  end if;
  return jsonb_build_object('ok', true, 'incubator_id', v_m.incubator_id);
end $$;

create or replace function public.incubator_remove_member(p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m incubator_members%rowtype;
begin
  select * into v_m from incubator_members where id = p_member_id for update;
  if not found or not public.is_incubator_owner(v_m.incubator_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_m.status = 'removed' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_m.role = 'owner' and v_m.status = 'active' and (
    select count(*) from incubator_members
    where incubator_id = v_m.incubator_id and role = 'owner' and status = 'active'
  ) <= 1 then
    return jsonb_build_object('ok', false, 'error', 'last_owner');
  end if;
  update incubator_members set status = 'removed', removed_at = now(), invite_token_hash = null where id = v_m.id;
  update incubator_relationships set manager_member_id = null where manager_member_id = v_m.id;
  return jsonb_build_object('ok', true);
end $$;

-- Owner edits the public-facing profile. related_catalog_entity_id, vat_id,
-- stripe_customer_id, is_test/is_internal and closing stay back-office only.
create or replace function public.incubator_update_profile(
  p_incubator_id uuid, p_name text, p_kind text, p_website text, p_city text, p_logo_url text, p_description text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_incubator_owner(p_incubator_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  if p_kind not in ('municipal', 'university', 'private_accelerator', 'corporate', 'pre_incubation', 'other') then
    return jsonb_build_object('ok', false, 'error', 'invalid_kind');
  end if;
  update incubators
    set name = btrim(p_name), kind = p_kind, website = nullif(btrim(p_website), ''),
        city = nullif(btrim(p_city), ''), logo_url = nullif(btrim(p_logo_url), ''),
        description = nullif(btrim(p_description), '')
    where id = p_incubator_id;
  return jsonb_build_object('ok', true);
end $$;

-- ===========================================================================
-- Read functions. Each returns exactly the columns its screen shows, so no
-- policy has to open a whole founder table (orgs) or a whole incubator row
-- (vat_id, stripe_customer_id) to anyone.

-- Portfolio (C.3). Level 0 content only: name for every non-ended row;
-- sector and stage only while access is live (active/graduated) — a paused
-- relationship shows its name and nothing else of the startup.
create or replace function public.incubator_portfolio(p_incubator_id uuid)
returns table (
  relationship_id uuid, org_id uuid, startup_name text, sector text, stage text,
  cohort_id uuid, cohort_name text, status text, sharing_level smallint,
  manager_member_id uuid, manager_name text, started_at timestamptz, has_live_access boolean
) language sql stable security definer set search_path = public as $$
  select r.id, r.org_id, o.name,
         case when r.status in ('active', 'graduated') then o.sector end,
         case when r.status in ('active', 'graduated') then o.stage::text end,
         r.cohort_id, c.name, r.status, r.sharing_level,
         r.manager_member_id, coalesce(m.full_name, m.invited_email), r.started_at,
         r.status in ('active', 'graduated')
  from incubator_relationships r
  join orgs o on o.id = r.org_id
  left join incubator_cohorts c on c.id = r.cohort_id
  left join incubator_members m on m.id = r.manager_member_id
  where r.incubator_id = p_incubator_id
    and r.status <> 'ended'
    and public.is_incubator_member(p_incubator_id)
  order by r.started_at desc;
$$;

-- Founder › Definições › Programas (C.4): every relationship of the caller's
-- org(s), with only the incubator fields the screen shows. D3: the founder
-- learns THAT the house also invests (a boolean), never the catalog id.
create or replace function public.founder_incubator_relationships()
returns table (
  relationship_id uuid, org_id uuid, incubator_id uuid, incubator_name text, incubator_logo_url text,
  incubator_kind text, incubator_also_invests boolean, cohort_name text, status text,
  sharing_level smallint, public_badge boolean, started_at timestamptz, graduated_at timestamptz,
  ended_at timestamptz, ended_by text, end_reason text
) language sql stable security definer set search_path = public as $$
  select r.id, r.org_id, i.id, i.name, i.logo_url, i.kind, i.related_catalog_entity_id is not null,
         c.name, r.status, r.sharing_level, r.public_badge, r.started_at, r.graduated_at,
         r.ended_at, r.ended_by, r.end_reason
  from incubator_relationships r
  join incubators i on i.id = r.incubator_id
  left join incubator_cohorts c on c.id = r.cohort_id
  where public.is_org_member(r.org_id)
  order by (r.status = 'ended'), r.started_at desc;
$$;

-- "Quem consultou" (C.4) — who, what, when, for the caller's org(s).
create or replace function public.founder_incubator_access_log()
returns table (
  id uuid, relationship_id uuid, incubator_name text, member_name text, surface text,
  target_id uuid, viewed_at timestamptz
) language sql stable security definer set search_path = public as $$
  select l.id, l.relationship_id, i.name, coalesce(m.full_name, m.invited_email, 'Gestor'), l.surface,
         l.target_id, l.viewed_at
  from incubator_access_log l
  join incubator_relationships r on r.id = l.relationship_id
  join incubators i on i.id = r.incubator_id
  left join incubator_members m on m.id = l.member_id
  where public.is_org_member(r.org_id)
  order by l.viewed_at desc
  limit 500;
$$;

-- Team list (C.3 Equipa) with the member's e-mail, which lives in
-- auth.users and is not otherwise readable.
create or replace function public.incubator_team(p_incubator_id uuid)
returns table (
  member_id uuid, user_id uuid, email text, full_name text, title text, role text, status text,
  accepted_at timestamptz, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, coalesce(u.email, m.invited_email), m.full_name, m.title, m.role, m.status,
         m.accepted_at, m.created_at
  from incubator_members m
  left join auth.users u on u.id = m.user_id
  where m.incubator_id = p_incubator_id and m.status <> 'removed'
    and public.is_incubator_member(p_incubator_id)
  order by m.role, m.created_at;
$$;

-- ===========================================================================
-- A.9 RLS + grants.
alter table public.incubators enable row level security;
alter table public.incubator_members enable row level security;
alter table public.incubator_cohorts enable row level security;
alter table public.incubator_invites enable row level security;
alter table public.incubator_relationships enable row level security;
alter table public.incubator_access_log enable row level security;

revoke all on public.incubators, public.incubator_members, public.incubator_cohorts,
  public.incubator_invites, public.incubator_relationships, public.incubator_access_log
  from public, anon, authenticated;

-- incubators: members read their own; platform admins write. Founders read
-- the four fields they need through founder_incubator_relationships(), not
-- through this table (stricter than a founder branch here, which would hand
-- them vat_id/stripe_customer_id too — RLS cannot restrict columns).
grant select, insert, update on public.incubators to authenticated;
create policy incubators_member_read on public.incubators for select
  using (public.is_incubator_member(id) or public.is_platform_admin());
create policy incubators_admin_insert on public.incubators for insert
  with check (public.is_platform_admin());
create policy incubators_admin_update on public.incubators for update
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- incubator_members: read only; every write is an owner-checked function
-- (a direct update policy would let a manager promote themselves to owner).
grant select on public.incubator_members to authenticated;
create policy incubator_members_read on public.incubator_members for select
  using (public.is_incubator_member(incubator_id) or user_id = auth.uid());

-- incubator_cohorts: members manage them. auto_promo_code_id stays null
-- until I-02 gives vouchers an owner.
grant select, insert on public.incubator_cohorts to authenticated;
grant update (name, starts_on, ends_on, archived_at) on public.incubator_cohorts to authenticated;
create policy incubator_cohorts_read on public.incubator_cohorts for select
  using (public.is_incubator_member(incubator_id));
create policy incubator_cohorts_insert on public.incubator_cohorts for insert
  with check (public.is_incubator_member(incubator_id) and auto_promo_code_id is null);
create policy incubator_cohorts_update on public.incubator_cohorts for update
  using (public.is_incubator_member(incubator_id))
  with check (public.is_incubator_member(incubator_id) and auto_promo_code_id is null);

-- incubator_invites: members create them; status moves only through the
-- functions above (column-level update grant leaves status, token and
-- acceptance columns out of reach). promo_code_id must be null until I-02:
-- no promo code belongs to an incubator yet, and a member attaching a
-- global code to an invite would hand it out under the incubator's name.
grant select on public.incubator_invites to authenticated;
grant insert (incubator_id, cohort_id, email, startup_name, sector, website, note, invited_by, token_hash, token_expires_at, sent_at, last_sent_at, send_count)
  on public.incubator_invites to authenticated;
grant update (startup_name, sector, website, note, cohort_id, sent_at, last_sent_at, send_count)
  on public.incubator_invites to authenticated;
create policy incubator_invites_read on public.incubator_invites for select
  using (public.is_incubator_member(incubator_id));
create policy incubator_invites_insert on public.incubator_invites for insert
  with check (
    public.is_incubator_member(incubator_id)
    and status = 'invited'
    and promo_code_id is null
    and accepted_org_id is null
    and invited_by = public.incubator_my_member_id(incubator_id)
    and (cohort_id is null or exists (
      select 1 from public.incubator_cohorts c where c.id = cohort_id and c.incubator_id = incubator_invites.incubator_id
    ))
  );
create policy incubator_invites_update on public.incubator_invites for update
  using (public.is_incubator_member(incubator_id))
  with check (
    public.is_incubator_member(incubator_id)
    and (cohort_id is null or exists (
      select 1 from public.incubator_cohorts c where c.id = cohort_id and c.incubator_id = incubator_invites.incubator_id
    ))
  );

-- incubator_relationships: read by both sides; written only by the functions.
grant select on public.incubator_relationships to authenticated;
create policy incubator_relationships_read on public.incubator_relationships for select
  using (public.is_incubator_member(incubator_id) or public.is_org_member(org_id));

-- incubator_access_log: read by both sides; written only by incubator_log_access().
grant select on public.incubator_access_log to authenticated;
create policy incubator_access_log_read on public.incubator_access_log for select
  using (exists (
    select 1 from public.incubator_relationships r
    where r.id = relationship_id
      and (public.is_org_member(r.org_id) or public.is_incubator_member(r.incubator_id))
  ));

-- Functions: nothing for public/anon; the ones a signed-in caller uses get
-- authenticated (incubator_decline_invite included since I-01b: it now
-- checks the caller's address, so it needs a session). Trigger functions get
-- nothing: Postgres never needs EXECUTE from the role firing a trigger
-- (confirmed live for deal_terms in Prompt 898).
revoke execute on function
  public.incubators_touch_updated_at(),
  public.incubator_relationships_before_update(),
  public.is_incubator_member(uuid),
  public.is_incubator_owner(uuid),
  public.has_active_incubator_membership(),
  public.incubator_can_view(uuid, smallint),
  public.incubator_my_member_id(uuid),
  public.incubator_caller_open_org(),
  public.incubator_caller_org_can_manage(uuid),
  public.incubator_mask_email(text),
  public.incubator_accept_invite(text),
  public.incubator_decline_invite(text),
  public.incubator_set_sharing_level(uuid, smallint),
  public.incubator_set_public_badge(uuid, boolean),
  public.incubator_end_relationship(uuid, text),
  public.incubator_set_status(uuid, text),
  public.incubator_log_access(uuid, text, uuid),
  public.incubator_revoke_invite(uuid),
  public.incubator_resend_invite(uuid, text),
  public.incubator_invite_member(uuid, text, text, text, text),
  public.incubator_accept_member_invite(text),
  public.incubator_remove_member(uuid),
  public.incubator_update_profile(uuid, text, text, text, text, text, text),
  public.incubator_portfolio(uuid),
  public.founder_incubator_relationships(),
  public.founder_incubator_access_log(),
  public.incubator_team(uuid)
  from public, anon, authenticated;

grant execute on function
  public.is_incubator_member(uuid),
  public.is_incubator_owner(uuid),
  public.has_active_incubator_membership(),
  public.incubator_can_view(uuid, smallint),
  public.incubator_my_member_id(uuid),
  public.incubator_accept_invite(text),
  public.incubator_decline_invite(text),
  public.incubator_set_sharing_level(uuid, smallint),
  public.incubator_set_public_badge(uuid, boolean),
  public.incubator_end_relationship(uuid, text),
  public.incubator_set_status(uuid, text),
  public.incubator_log_access(uuid, text, uuid),
  public.incubator_revoke_invite(uuid),
  public.incubator_resend_invite(uuid, text),
  public.incubator_invite_member(uuid, text, text, text, text),
  public.incubator_accept_member_invite(text),
  public.incubator_remove_member(uuid),
  public.incubator_update_profile(uuid, text, text, text, text, text, text),
  public.incubator_portfolio(uuid),
  public.founder_incubator_relationships(),
  public.founder_incubator_access_log(),
  public.incubator_team(uuid)
  to authenticated;
-- incubator_caller_open_org, incubator_caller_org_can_manage and
-- incubator_mask_email are internal helpers of the functions above;
-- service_role keeps EXECUTE on everything through its own default privileges.

-- ===========================================================================
-- C.5 — the invite/notice e-mails are logged like every other platform
-- e-mail. Widening a CHECK on a log table, not a policy.
alter table public.email_send_log drop constraint if exists email_send_log_kind_check;
alter table public.email_send_log add constraint email_send_log_kind_check check (kind in (
  'guest_invite', 'access_notify', 'access_grant', 'support', 'other',
  'incubator_invite', 'incubator_member_invite', 'incubator_relationship_ended'
));
