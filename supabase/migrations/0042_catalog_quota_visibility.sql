-- Plan-based investor visibility (pipeline "vidro fosco" blocking).
-- Fourth revision — two more fixes on top of the third review pass:
--   A. The policy-discovery DO loop now RAISE NOTICEs every policy it
--      drops (name, cmd, qual) before dropping it, so applying this
--      migration in the SQL Editor prints an audit trail — no silent loss
--      of a policy nobody remembered existed (e.g. a hypothetical
--      platform_admin SELECT policy). Checked the actual schema history
--      (0001_init.sql's generic org-scoped-policy loop, the only place
--      entities' RLS is defined) and confirmed no such policy exists
--      today — is_org_member(org_id) is the only clause — but the notice
--      makes that verifiable at apply-time instead of assumed.
--      Deliberately NOT recreating a platform_admin bypass even if one
--      turned up: that would reopen exactly the "no developer can see the
--      full list" hole this whole feature exists to close. Back-office
--      code that legitimately needs full entity data already uses the
--      service-role client (bypasses RLS by design), never this policy.
--   B. Sticky unlock (entities.unlocked_at): once a catalog entity has
--      ever been visible to an org, it stays visible forever, even if a
--      later re-rank (a manual wave/fit edit today; the matching engine
--      once it exists — see MATCHING_ENGINE_SPEC.md) would have pushed it
--      below the quota line.
--   C. (This revision) The baseline backfill for B was ALMOST a bug of its
--      own: it stamped "whatever ranks in the top N today" as permanently
--      unlocked — but today's rank is meaningless (every catalog entity
--      carries hardcoded wave=3/fit='medium', no real engine exists yet),
--      so that would have cemented an arbitrary, insertion-order set
--      forever, irreversibly, ahead of genuinely-better-aligned investors
--      once real scoring ships. Fixed: the backfill (and
--      sync_catalog_unlocks generally) only stamps entities the founder
--      has demonstrably already worked on; auto-syncing on rank is no
--      longer wired to any trigger until the engine gives rank real
--      meaning. See the comment on sync_catalog_unlocks for the full
--      reasoning.
--   D. guard_entity_source is now guard_catalog_service_columns and also
--      protects unlocked_at from a direct client write — see below.
--   E. Two new nullable columns, `tier` and `tier_classified_at`, for the
--      catalog quality doctrine (DECISIONS.md). Purely additive — see the
--      comment where they're added. No gating logic in this migration.

alter table entities
  add column source text not null default 'manual'
    check (source in ('catalog', 'manual', 'match_deal'));
-- No backfill from catalog_deliveries, deliberately (confirmed decision):
-- every entity that existed before this migration is 'manual' — nothing is
-- reclassified or blocked retroactively.

-- Sticky unlock — stamped once, never cleared. NULL = "not yet decided
-- either way"; non-null = "permanently visible, regardless of future rank."
alter table entities add column unlocked_at timestamptz;

-- Deliverability tier (catalog quality doctrine — DECISIONS.md "Catalog
-- deliverability tiers"). Purely additive here: the column exists so the
-- future qualification pass has somewhere to write, but NOTHING in this
-- migration reads it — catalog_is_visible/plan_catalog_quota/
-- catalog_blocked_count are all unchanged, rank-based visibility works
-- exactly as before. Gating quota/visibility on tier is deliberately
-- deferred to its own migration (0044), applied only once the
-- qualification pass has actually covered the catalog — not now, while
-- every row is unclassified and Tier A's own definition is still moving
-- (a pilot found named-person email coverage too low to require it
-- outright; LinkedIn / institutional submission-with-named-person will
-- likely also satisfy the "reachable" bar once that's finalized). Writing
-- the gate against today's definition would mean rewriting it anyway.
alter table entities add column tier text check (tier in ('A', 'B', 'C'));
alter table entities add column tier_classified_at timestamptz;

-- Covers the RLS policy's correlated lookup (via catalog_is_visible) and
-- catalog_blocked_count's aggregate in one index.
create index on entities (org_id, source, wave, fit_score, created_at, id);
create index on entities (org_id, source, unlocked_at) where source = 'catalog';

-- Same fit_score ordering the pipeline table's own default sort already
-- uses (fitOrder in pipeline/page.tsx) — single definition, reused by
-- catalog_is_visible below and kept immutable so it's usable in an index.
create or replace function fit_rank(f fit_score) returns int
language sql immutable as $$
  select case f when 'high' then 0 when 'medium_high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end;
$$;

-- ===== Quota accumulation =====
-- The quota is a per-org counter, not a fixed function of plan tier — it
-- only ever goes up, so it survives a downgrade and can grow independently
-- of plan changes (a future payment-webhook increment — see DECISIONS.md;
-- deliberately NOT built in this migration, see the note at the bottom).
-- Seeded here from each org's CURRENT plan tier as a one-time starting
-- baseline (idea=3, garage=15, motherfunding=40 — the confirmed numbers).
alter table orgs add column catalog_quota int not null default 3;
update orgs set catalog_quota = case plan
  when 'idea' then 3
  when 'garage' then 15
  when 'motherfunding' then 40
  else 3
end;

create or replace function plan_catalog_quota(check_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select catalog_quota from orgs where id = check_org;
$$;

-- The actual per-row visibility check, SECURITY DEFINER so it can query
-- entities without re-entering entities' own RLS. Two cases:
--   1. Already sticky-unlocked (unlocked_at is not null) -> always true.
--   2. Not yet unlocked -> ranked among the OTHER not-yet-unlocked catalog
--      rows for the org (wave, fit, created_at, id as a final always-
--      distinct tiebreaker), and visible iff that rank is within the
--      REMAINING quota — quota minus however many are already
--      permanently unlocked. This is what keeps the quota from being
--      breached: an already-unlocked entity doesn't compete for a slot a
--      second time, but it still counts against the total.
create or replace function catalog_is_visible(e_id uuid, e_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select true from entities where id = e_id and org_id = e_org and source = 'catalog' and unlocked_at is not null),
    (
      select rn <= remaining
      from (
        select id,
               row_number() over (
                 order by coalesce(wave, 999), fit_rank(fit_score), created_at, id
               ) as rn,
               greatest(0, plan_catalog_quota(e_org) - (
                 select count(*) from entities where org_id = e_org and source = 'catalog' and unlocked_at is not null
               )) as remaining
        from entities
        where org_id = e_org and source = 'catalog' and unlocked_at is null
      ) candidates
      where id = e_id
    ),
    false
  );
$$;

-- Stamps unlocked_at on every catalog entity that's currently rank-visible
-- but not yet permanently unlocked — the mechanism that turns "visible
-- right now because of rank" into "visible forever." Defined here as a
-- plain callable function, but DELIBERATELY NOT WIRED to any trigger yet
-- (no auto-fire on quota increase or new catalog delivery) — same reason
-- the baseline backfill below stopped being rank-based: today's ranking
-- (wave=3/fit='medium' hardcoded at delivery, no real engine — see
-- MATCHING_ENGINE_SPEC.md) is really just insertion order, and sticky-
-- stamping ANY rank-derived set right now, automatically, on every future
-- pack delivery between today and when the engine ships, would keep
-- reproducing the exact bug this review caught in the backfill — just
-- spread out over time instead of all at once. `catalog_is_visible` alone
-- (used directly by the RLS policies) already handles live, non-sticky
-- visibility correctly with no engine involved — nothing is broken by not
-- auto-stamping yet, rank-visible rows are still visible, they just aren't
-- PERMANENTLY visible until deliberately stamped.
--
-- Call this manually (or wire it to a trigger) only once ranking means
-- something — i.e. once the matching engine has run its first real
-- scoring pass for an org. That wiring is the engine's migration's job,
-- not this one's.
create or replace function sync_catalog_unlocks(check_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Session-local flag (resets automatically at transaction end — the
  -- `true` third arg to set_config) so the guard trigger below can tell
  -- "this write came from this trusted function" apart from "a client
  -- PATCHed unlocked_at directly." Only this function's own UPDATE, right
  -- below, ever runs with the flag set.
  perform set_config('app.internal_catalog_write', 'true', true);
  update entities
  set unlocked_at = now()
  where org_id = check_org and source = 'catalog' and unlocked_at is null
    and catalog_is_visible(id, check_org);
end;
$$;

-- Baseline backfill — NOT rank-based, deliberately (review caught this
-- before apply). Every catalog entity in this system today carries
-- wave=3/fit='medium' hardcoded at delivery (no real matching engine
-- exists yet — see MATCHING_ENGINE_SPEC.md) — so `row_number() order by
-- wave, fit, created_at, id` is really just insertion order. Sticky-
-- unlocking "whatever ranks in the top N by insertion order" would have
-- permanently cemented an arbitrary set, irreversibly (unlocked_at never
-- clears), and once the real engine ships and re-ranks for real, genuinely
-- better-aligned investors would sit locked behind a quota already spent
-- on rows that never earned it.
--
-- Instead, the ONLY thing this migration stamps as permanently unlocked is
-- what the founder has demonstrably already worked on — nobody should ever
-- have something they've engaged with pulled out from under them, and this
-- is the one set for which that expectation predates this migration.
-- Everything else stays purely rank-derived (catalog_is_visible still
-- resolves it live, same as any not-yet-unlocked row) until the real
-- engine runs its first genuine scoring pass and sync_catalog_unlocks
-- stamps based on a ranking that actually means something.
--
-- "Already worked on" = any of: status moved off the initial default,
-- a logged interaction exists, founder-entered notes, a soft-circled
-- interest amount, or an active outbound contact lock (set specifically
-- on a logged outbound touch — see LOCK_DAYS in rules.ts).
do $$
declare o record;
begin
  for o in select id from orgs loop
    perform set_config('app.internal_catalog_write', 'true', true);
    update entities e
    set unlocked_at = now()
    where e.org_id = o.id and e.source = 'catalog' and e.unlocked_at is null
      and (
        e.status <> 'not_contacted'
        or e.notes is not null
        or e.interest_eur is not null
        or e.contact_lock_until is not null
        or exists (select 1 from interactions i where i.entity_id = e.id)
      );
  end loop;
end;
$$;

-- Number of catalog-sourced entities beyond the org's accumulated quota —
-- exactly what the pipeline's frosted-glass panel needs to show ("N more
-- blocked"), and NOTHING else: no ids, no names, no fields. Security
-- definer + its own is_org_member check (same pattern as is_org_member /
-- is_platform_admin) since it deliberately reads past what RLS alone would
-- allow the caller to select (a raw count, not the rows).
-- Total minus CURRENTLY VISIBLE (sticky-unlocked OR live rank-visible) —
-- not total minus unlocked_count. Those two aren't the same number: with
-- sync_catalog_unlocks not auto-wired to any trigger (see the comment on
-- that function), a rank-visible-but-not-yet-stamped row is still visible
-- right now and must not count as blocked, even though unlocked_at is
-- still null for it.
create or replace function catalog_blocked_count(check_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when is_org_member(check_org) then (
    select count(*)::int from entities
    where org_id = check_org and source = 'catalog'
      and not (unlocked_at is not null or catalog_is_visible(id, check_org))
  ) else 0 end;
$$;
grant execute on function catalog_blocked_count(uuid) to authenticated;

-- ===== RLS =====
-- Drop EVERY existing policy on entities by querying pg_policies at
-- apply-time — no policy name assumed. Each drop is RAISE NOTICEd first
-- (name, cmd, qual) so the migration's own output is the audit trail: if
-- anything unexpected (e.g. a platform_admin clause) shows up here, STOP
-- and tell me before re-running — don't just let it silently vanish.
do $$
declare pol record;
begin
  for pol in select policyname, cmd, qual::text as qual_text, with_check::text as with_check_text
             from pg_policies where schemaname = 'public' and tablename = 'entities'
  loop
    raise notice 'Dropping entities policy "%": cmd=%, using=%, with_check=%',
      pol.policyname, pol.cmd, pol.qual_text, pol.with_check_text;
    execute format('drop policy %I on entities', pol.policyname);
  end loop;
end;
$$;

create policy entities_write on entities for insert with check (is_org_member(org_id));

-- Hardened per review: USING must include the same visibility check as
-- SELECT (unlocked_at sticky OR catalog_is_visible), not just
-- is_org_member — otherwise an UPDATE/DELETE ... RETURNING * against a
-- blocked row's id leaks its full data, or a source flip permanently
-- unlocks it. Applies to DELETE too, not just UPDATE — same RETURNING leak.
create policy entities_update on entities for update
  using (is_org_member(org_id) and (source <> 'catalog' or unlocked_at is not null or catalog_is_visible(id, org_id)))
  with check (is_org_member(org_id));
create policy entities_delete on entities for delete
  using (is_org_member(org_id) and (source <> 'catalog' or unlocked_at is not null or catalog_is_visible(id, org_id)));

create policy entities_select on entities for select using (
  is_org_member(org_id)
  and (source <> 'catalog' or unlocked_at is not null or catalog_is_visible(id, org_id))
);

-- Defense in depth beyond the hardened USING clauses above:
--   1. A catalog row's source can never be changed away from 'catalog' via
--      UPDATE, full stop (unchanged from the prior revision).
--   2. unlocked_at is a commercial-value column now — whoever can write it
--      unlocks themselves forever. The UPDATE policy's USING clause
--      already means a BLOCKED row can't be targeted at all, but this is
--      defense in depth on a requirement classified as critical, for the
--      cost of a few lines: a client can never write unlocked_at directly,
--      even on a row they can already see. Only sync_catalog_unlocks (via
--      the session-local app.internal_catalog_write flag it sets right
--      before its own UPDATE) may set it.
create or replace function guard_catalog_service_columns() returns trigger
language plpgsql as $$
begin
  if old.source = 'catalog' and new.source <> 'catalog' then
    raise exception 'A entidade de catálogo % não pode ter o source alterado.', old.id;
  end if;
  if new.unlocked_at is distinct from old.unlocked_at
     and coalesce(current_setting('app.internal_catalog_write', true), '') <> 'true' then
    raise exception 'unlocked_at na entidade % só pode ser escrito pelo sistema.', old.id;
  end if;
  return new;
end;
$$;

create trigger entities_guard_catalog_service_columns before update on entities
  for each row execute function guard_catalog_service_columns();

-- Fails loud, at migration-apply time, if anything other than
-- entities_select is still doing SELECT/ALL on entities.
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'entities'
     and cmd in ('SELECT', 'ALL') and policyname <> 'entities_select';
  if n > 0 then
    raise exception 'Restam % políticas SELECT/ALL em entities além de entities_select — o bloqueio seria anulado por OR.', n;
  end if;
end;
$$;

-- NOT built in this migration, deliberately (a product/ops decision, not a
-- schema one — flagged per DECISIONS.md rather than silently assumed): the
-- mechanism that increments orgs.catalog_quota going forward. Confirmed a
-- real Stripe webhook already exists (src/app/api/stripe/webhook/route.ts)
-- and is the right place to hang this — but Stripe redelivers events by
-- design, so the increment must be idempotent by Stripe's own event id
-- (store it, check-before-increment), not just "add N on every successful-
-- payment event": a replayed event must never hand out catalog for free a
-- second time, silently and irreversibly (catalog_quota never decrements).
-- Scoping and building this is a separate, smaller task.
