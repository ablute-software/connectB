-- Prompt 581 §D — quarantine for what a startup says about a catalog
-- person: a founder edits their own private `people` row, that becomes a
-- `contributions` row against the matching `catalog_people` row, an admin
-- (or 3 independent orgs agreeing) promotes it into the catalog, and orgs
-- with nothing of their own for that field start seeing the catalog's
-- value. None of this existed before this migration — confirmed by
-- reading migration 0146's own header (people/catalog_people are
-- deliberately unbridged) and by tracing every write path into `people`:
-- no existing fallback/bridge of any kind.
--
-- Design note that isn't in the prompt but has to be, because it breaks
-- silently otherwise: contributions.subject_type='person' ALREADY means
-- something today — subject_id is a `people.id` (the founder-private
-- table), and approving one writes straight to that row
-- (contribution-promotion.ts's applyVerifiedContribution does
-- `admin.from('people').update(...).eq('id', c.subject_id)`, and
-- /api/backoffice/contributions/route.ts resolves subject_name the same
-- way). The prompt's own §D.2 asks for subject_id=catalog_person_id for
-- the NEW flow — a different id space entirely. Reusing 'person' for both
-- would make the existing approval path either silently no-op (lookup
-- misses) or, if a `people.id` and a `catalog_people.id` ever collided,
-- write to the wrong row. So: a genuinely new subject_type,
-- 'catalog_person', keeps the existing private-people contribution flow
-- (ContributionBox, the founder's own Accept button, the just-landed
-- Prompt 572 queue) completely untouched, and gives this new
-- catalog-quarantine flow its own lane. The one place this touches
-- outside this file: /api/backoffice/contributions/route.ts's GET gets a
-- one-line `.in('subject_type', ['entity','person'])` guard so these new
-- rows don't show up there mislabeled "(deleted)" — that query has no
-- subject_type filter today and would otherwise happily return them.

alter type contribution_subject add value if not exists 'catalog_person';

-- ============================================================
-- §D.1 — the missing key
-- ============================================================
alter table public.people
  add column if not exists catalog_person_id uuid references public.catalog_people(id) on delete set null;

create index if not exists people_catalog_person_id_idx
  on public.people (catalog_person_id) where catalog_person_id is not null;

comment on column public.people.catalog_person_id is
  'The catalog_people row this person corresponds to, when known. Links the founder-private overlay to the global catalog record so Prompt 581''s contribution/quarantine flow has something to point at. Backfilled once below by name+entity match; a row that stays null needs a manual link (query for it, no dedicated UI shipped in this prompt — see Prompt 581 report).';

-- Backfill. people.entity_id points at the PRIVATE `entities` table, which
-- only sometimes knows its catalog_entities correspondence
-- (entities.catalog_id, migration 0316 — nullable, seeded from
-- catalog_deliveries by Prompt 570's reconcile, not universal). So the
-- join has to go entities.catalog_id -> catalog_person_affiliations.
-- entity_id, then match on name. Normalization here is deliberately
-- simple (lower + collapse whitespace) rather than catalog-dedupe.ts's
-- full normalizeName (diacritics/legal-suffix/parenthetical stripping):
-- that machinery exists to catch two DIFFERENT-looking firm names that
-- might be the same firm; here we're matching a person's own name against
-- itself for one already-known entity_id, a much narrower, safer
-- comparison that doesn't need it. row_number() picks one affiliation
-- when a name matches more than one candidate (current + primary first)
-- rather than erroring or picking arbitrarily.
with candidates as (
  select
    p.id as person_id,
    cpa.person_id as catalog_person_id,
    row_number() over (
      partition by p.id
      order by cpa.is_primary desc, cpa.current desc
    ) as rn
  from public.people p
  join public.entities e on e.id = p.entity_id and e.catalog_id is not null
  join public.catalog_person_affiliations cpa on cpa.entity_id = e.catalog_id
  join public.catalog_people cp on cp.id = cpa.person_id
  where p.catalog_person_id is null
    and lower(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g'))
      = lower(regexp_replace(btrim(cp.full_name), '\s+', ' ', 'g'))
)
update public.people p
set catalog_person_id = c.catalog_person_id
from candidates c
where c.person_id = p.id and c.rn = 1;

-- ============================================================
-- based_in has nowhere to live on the catalog side yet. It reads as a
-- neutral fact (where someone is based), same category as full_name/
-- linkedin_url — migration 0146's own DESVIO 2 draws exactly this line
-- between catalog_people (neutral facts) and catalog_people_research
-- (research) — not a new distinction invented here.
-- ============================================================
alter table public.catalog_people add column if not exists based_in text;

-- ============================================================
-- §D.3 — verification_level. catalog_people_research is ONE ROW per
-- person (bio_raw/hook/intro_path/... all on the same row) — a row-level
-- verification_level would already be wrong the day bio_raw is an
-- unconfirmed AI guess while hook has just been confirmed by 3 startups.
-- verified_fields keeps one level per field on the SAME row instead of
-- adding a *_verification_level column per field (there are 9 tracked
-- fields, 3 of which don't even live on this table — see
-- catalog_person_apply_field below). This is the "Code chooses and
-- justifies" schema-shape call the prompt asks for.
-- ============================================================
alter table public.catalog_people_research
  add column if not exists verified_fields jsonb not null default '{}'::jsonb;

comment on column public.catalog_people_research.verified_fields is
  'Per-field verification level, e.g. {"hook": "verified_by_startups"}. Keys are the 9 Prompt 581 §D.2 field names, regardless of which table the field''s actual VALUE lives on (role -> catalog_person_affiliations.title, based_in/linkedin_url -> catalog_people, the rest -> this row). One of: unverified (absent key), verified_by_startups, verified_by_admin, verified_by_person.';

-- ============================================================
-- Shared write: applies one field's confirmed value onto the catalog
-- (research row, catalog_people, or the person's primary affiliation for
-- role) and records the verification level reached — then reverse-syncs
-- (§D.5) into every org's private `people` row that has NOTHING of its
-- own in that field yet. "Nothing of its own" is the same non-clobbering
-- shape as the one existing convention for this class of problem
-- (preferDeclaredValue/preferDeclaredList in claimed-investor-profile.ts:
-- declared wins when non-empty, researched otherwise) — confirmed by
-- reading it there's no OTHER existing people-side fallback to collide
-- with. Reused by both the consensus trigger below and the admin-approval
-- API route (§D.4, application code) so both paths write through exactly
-- one place rather than two copies that can drift.
-- ============================================================
create or replace function public.catalog_person_apply_field(
  p_person_id uuid, p_field text, p_value jsonb, p_level text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text := p_value #>> '{}';
  v_words text[];
begin
  insert into catalog_people_research (person_id) values (p_person_id)
    on conflict (person_id) do nothing;

  if p_field = 'role' then
    update catalog_person_affiliations set title = v_text
      where person_id = p_person_id and is_primary = true;
    update people set role = v_text
      where catalog_person_id = p_person_id and coalesce(btrim(role), '') = '';

  elsif p_field = 'based_in' then
    update catalog_people set based_in = v_text where id = p_person_id;
    update people set based_in = v_text
      where catalog_person_id = p_person_id and coalesce(btrim(based_in), '') = '';

  elsif p_field = 'linkedin_url' then
    update catalog_people set linkedin_url = v_text where id = p_person_id;
    update people set linkedin_url = v_text
      where catalog_person_id = p_person_id and coalesce(btrim(linkedin_url), '') = '';

  elsif p_field = 'kill_words' then
    v_words := array(select jsonb_array_elements_text(p_value));
    update catalog_people_research set kill_words = v_words where person_id = p_person_id;
    update people set kill_words = v_words
      where catalog_person_id = p_person_id and coalesce(array_length(kill_words, 1), 0) = 0;

  elsif p_field in ('background', 'hook', 'watch_outs', 'intro_path', 'email_guess') then
    execute format('update catalog_people_research set %I = $1 where person_id = $2', p_field)
      using v_text, p_person_id;
    execute format(
      'update people set %I = $1 where catalog_person_id = $2 and coalesce(btrim(%I), '''') = ''''',
      p_field, p_field
    ) using v_text, p_person_id;

  else
    -- Unknown field name: never write, never raise. A bad field somehow
    -- reaching here must not break the caller (a trigger on every
    -- founder's `people` UPDATE, or an admin's approval click).
    return;
  end if;

  update catalog_people_research
    set verified_fields = verified_fields || jsonb_build_object(p_field, p_level)
    where person_id = p_person_id;
end;
$$;

-- ============================================================
-- §D.3 — consensus. 3 distinct orgs independently landing on the same
-- normalized value for the same (person, field) promotes it straight to
-- verified_by_startups, no admin click. linkedin_url and email_guess are
-- excluded per the prompt's own recommendation (§D.3, decision 2):
-- identity-bearing fields always need an admin or a technical check, no
-- matter how many startups agree. A field an admin or the person
-- themselves already confirmed is never silently overwritten by
-- consensus — 3 startups agreeing is strong evidence against an
-- unconfirmed guess, not against a human check that already happened.
-- ============================================================
create or replace function public.catalog_person_check_consensus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_count int;
  v_norm_value text;
  v_current_level text;
  v_admin_only constant text[] := array['linkedin_url', 'email_guess'];
begin
  if new.subject_type <> 'catalog_person' or new.status <> 'submitted' then return new; end if;
  if new.field = any(v_admin_only) then return new; end if;

  v_norm_value := lower(btrim(new.value #>> '{}'));
  if coalesce(v_norm_value, '') = '' then return new; end if;

  select count(distinct org_id) into v_org_count
  from contributions
  where subject_type = 'catalog_person' and subject_id = new.subject_id and field = new.field
    and status in ('submitted', 'verified')
    and lower(btrim(value #>> '{}')) = v_norm_value;

  if v_org_count < 3 then return new; end if;

  select verified_fields ->> new.field into v_current_level
  from catalog_people_research where person_id = new.subject_id;
  if v_current_level in ('verified_by_admin', 'verified_by_person') then return new; end if;

  update contributions
    set status = 'verified', reviewed_at = now(),
      reviewer_notes = trim(both ' · ' from coalesce(reviewer_notes || ' · ', '')
        || 'Auto-verified: ' || v_org_count || ' startups agree.')
    where subject_type = 'catalog_person' and subject_id = new.subject_id and field = new.field
      and status = 'submitted' and lower(btrim(value #>> '{}')) = v_norm_value;

  perform public.catalog_person_apply_field(new.subject_id, new.field, new.value, 'verified_by_startups');

  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (
    null, 'catalog_person_consensus_auto_verify', 'catalog_person', new.subject_id,
    jsonb_build_object('field', new.field, 'value', new.value, 'org_count', v_org_count)
  );

  return new;
end;
$$;

create trigger trg_catalog_person_check_consensus
  after insert on public.contributions
  for each row execute function public.catalog_person_check_consensus();

-- ============================================================
-- §D.2 — the automatic write. A founder editing their own `people` row
-- goes through store-supabase.tsx's updatePerson: a plain client-side
-- `sb.from('people').update(patch)`, no server route in between. "Nothing
-- changes for the founder besides this, and it's invisible to him" rules
-- out adding a second client-side network call (which the founder's own
-- browser would have to make, and which could fail independently of the
-- save itself) — a trigger is the only place this can live without
-- touching a single line of founder-facing code.
--
-- SECURITY DEFINER is load-bearing, not decoration, for the same reason
-- as migration 0247's enqueue_enrichment_for_delivery: contributions
-- INSERT is open to is_org_member(org_id), so THIS insert doesn't
-- strictly need it — but the consensus trigger it chains into writes to
-- catalog_people_research / catalog_person_affiliations / people /
-- admin_audit_log, all is_platform_admin()-only. Without DEFINER, a
-- founder's own UPDATE would get this trigger's write denied by RLS and
-- the ENTIRE people UPDATE would roll back — i.e. the very first time 3
-- orgs happened to agree on a field, every founder's own profile edits
-- would start failing.
-- ============================================================
create or replace function public.catalog_person_contribute(
  p_catalog_person_id uuid, p_org_id uuid, p_author uuid, p_field text, p_value jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into contributions (subject_type, subject_id, org_id, author_user_id, field, value, status, source, kind)
  values ('catalog_person', p_catalog_person_id, p_org_id, p_author, p_field, p_value, 'submitted', 'user', 'fill');
end;
$$;

create or replace function public.people_contribute_to_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.catalog_person_id is null then return new; end if;

  -- One block per tracked field, comparing against OLD so a save that
  -- touches other columns (or re-saves the same value) doesn't
  -- manufacture a contribution nothing actually changed. Written out
  -- explicitly (not a loop over column names) so each field stays a
  -- plain, auditable statement in SECURITY DEFINER code.
  if new.role is distinct from old.role and coalesce(btrim(new.role), '') <> '' then
    perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'role', to_jsonb(new.role));
  end if;
  if new.based_in is distinct from old.based_in and coalesce(btrim(new.based_in), '') <> '' then
    perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'based_in', to_jsonb(new.based_in));
  end if;
  if new.linkedin_url is distinct from old.linkedin_url and coalesce(btrim(new.linkedin_url), '') <> '' then
    perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'linkedin_url', to_jsonb(new.linkedin_url));
  end if;
  if new.background is distinct from old.background and coalesce(btrim(new.background), '') <> '' then
    perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'background', to_jsonb(new.background));
  end if;
  if new.hook is distinct from old.hook and coalesce(btrim(new.hook), '') <> '' then
    perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'hook', to_jsonb(new.hook));
  end if;
  if new.watch_outs is distinct from old.watch_outs and coalesce(btrim(new.watch_outs), '') <> '' then
    perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'watch_outs', to_jsonb(new.watch_outs));
  end if;
  if new.intro_path is distinct from old.intro_path and coalesce(btrim(new.intro_path), '') <> '' then
    perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'intro_path', to_jsonb(new.intro_path));
  end if;
  if new.email_guess is distinct from old.email_guess and coalesce(btrim(new.email_guess), '') <> '' then
    perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'email_guess', to_jsonb(new.email_guess));
  end if;
  if new.kill_words is distinct from old.kill_words and coalesce(array_length(new.kill_words, 1), 0) > 0 then
    perform public.catalog_person_contribute(new.catalog_person_id, new.org_id, auth.uid(), 'kill_words', to_jsonb(new.kill_words));
  end if;

  return new;
end;
$$;

create trigger trg_people_contribute_to_catalog
  after update on public.people
  for each row execute function public.people_contribute_to_catalog();

-- ============================================================
-- Prompt 581's own "Não fazer" says don't touch the Contributions queue
-- (572) — this is the one necessary exception, and it's a guard, not a
-- feature: without it, the new 'catalog_person' rows this migration
-- starts producing would flow straight into the already-shipped queue's
-- GET (no subject_type filter at all) and render as "(deleted)"
-- (personById.get() on a catalog_person_id, which is never in the
-- people-keyed map it builds) — a real regression in tested, shipped
-- code, not a new feature for this data. The People-filtered queue UI for
-- catalog_person contributions is still 572's own job, unchanged by this.
-- ============================================================
