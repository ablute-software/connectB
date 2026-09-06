-- Prompt 871 §C/§E — found by a separate verification session auditing
-- Prompt 581's landing on main: "3 startups agree" was fabricable without
-- any startup asserting anything, and the reverse-sync it promotes into
-- fuses provenance. Confirmed independently before writing this fix:
-- 0 catalog_person contributions exist yet and only 1 org has any
-- catalog_person_id-linked people (organic consensus has never fired), so
-- every change below is free to make now and costs nothing later.
--
-- §E first, because it changes what §C's own guard needs to cover. Nuno's
-- decision (2026-09-06, recorded in the prompt itself): option (a),
-- overlay at read time. catalog_person_apply_field stops writing to
-- `people` entirely — see src/lib/catalog-person-overlay.ts for the
-- read-time replacement on the founder side. That removal also makes the
-- 0325 reverse-sync GUC dead code: there is no longer a `people` write
-- inside this function for anything to suppress.
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
  v_rowcount int;
begin
  insert into catalog_people_research (person_id) values (p_person_id)
    on conflict (person_id) do nothing;

  if p_field = 'role' then
    update catalog_person_affiliations set title = v_text
      where person_id = p_person_id and is_primary = true;
    -- Prompt 871 "Menores" — a person with no primary affiliation row left
    -- this UPDATE a no-op while verified_fields.role still got marked
    -- below, claiming a verification that wrote nothing. Skip the mark
    -- when nothing was actually found to update.
    get diagnostics v_rowcount = row_count;
    if v_rowcount = 0 then return; end if;

  elsif p_field = 'based_in' then
    update catalog_people set based_in = v_text where id = p_person_id;

  elsif p_field = 'linkedin_url' then
    update catalog_people set linkedin_url = v_text where id = p_person_id;

  elsif p_field = 'kill_words' then
    v_words := array(select jsonb_array_elements_text(p_value));
    update catalog_people_research set kill_words = v_words where person_id = p_person_id;

  elsif p_field in ('background', 'hook', 'watch_outs', 'intro_path', 'email_guess') then
    execute format('update catalog_people_research set %I = $1 where person_id = $2', p_field)
      using v_text, p_person_id;

  else
    -- Unknown field name: never write, never raise. A bad field somehow
    -- reaching here must not break the caller (the consensus trigger, or
    -- an admin's approval click).
    return;
  end if;

  update catalog_people_research
    set verified_fields = verified_fields || jsonb_build_object(p_field, p_level)
    where person_id = p_person_id;
end;
$$;

-- §C.1 (part 1 of 2) — the general fix. `people_contribute_to_catalog`
-- treats ANY update to a founder's `people` row as that org's own
-- testimony. That's true for a founder's real edit (always their own
-- authenticated session — store-supabase.tsx's updatePerson), but not for
-- a write made by server-side code acting on the org's behalf: an admin
-- approving an AI-sourced proposal (contribution-promotion.ts's
-- applyVerifiedContribution, called from both the founder's own Accept
-- button route and the back-office Fila review queue) writes through a
-- FRESH service-role client in both call sites — confirmed by reading
-- both routes, not assumed. A service-role request carries no user JWT, so
-- auth.uid() is null there; a founder's own edit never has a null
-- auth.uid(). This is a more general fix than wrapping each call site in
-- the old GUC (which only covers writers that remember to wrap
-- themselves) — it holds for every current AND future service-role write
-- to `people`, not just the ones audited today.
--
-- Known residual gap, stated plainly (not silently left unmentioned): the
-- prompt's own §C.1 also names import/structured/commit/route.ts as a
-- second path. That route writes through the FOUNDER's own RLS-scoped
-- session (serverClient()), not service role — auth.uid() there is a real
-- user id, so this check does not suppress it. Closing that path safely
-- would need a privilege-checked RPC (re-deriving the org-membership check
-- RLS would have done, since a SECURITY DEFINER function bypasses RLS) —
-- a larger, separate change against a founder-facing data path, not a
-- one-line fix. Left for a follow-up; a bulk CSV import happening to touch
-- a tracked field on a catalog-linked person, whose value happens to match
-- what 2 other real (non-test) orgs already contributed, is the narrowest
-- of the three §C findings, not the one this migration closes.
create or replace function public.people_contribute_to_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.catalog_person_id is null then return new; end if;
  if auth.uid() is null then return new; end if;

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

-- §C.3 — dedupe by (org, person, field): each founder edit used to insert
-- a new 'submitted' row even when the org already had one for this exact
-- field, so the quarantine accumulated stale positions and an org that
-- changed its mind kept its old answer counting toward consensus too.
-- Confirmed empirically: 0 catalog_person contributions exist in
-- production today, so this index has nothing to reconcile.
create unique index if not exists contributions_catalog_person_org_field_uidx
  on public.contributions (subject_id, org_id, field)
  where subject_type = 'catalog_person';

create or replace function public.catalog_person_contribute(
  p_catalog_person_id uuid, p_org_id uuid, p_author uuid, p_field text, p_value jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into contributions (subject_type, subject_id, org_id, author_user_id, field, value, status, source, kind, created_at)
  values ('catalog_person', p_catalog_person_id, p_org_id, p_author, p_field, p_value, 'submitted', 'user', 'fill', now())
  on conflict (subject_id, org_id, field) where subject_type = 'catalog_person'
  do update set
    value = excluded.value, author_user_id = excluded.author_user_id,
    status = 'submitted', reviewed_at = null, reviewer_notes = null, created_at = now();
end;
$$;

-- §C.2/kill_words "Menores" — a small shared normalizer so the consensus
-- count, the verified-marking update, and any future caller compare
-- values the same way. Order-independent for arrays (kill_words:
-- ["a","b"] and ["b","a"] are the same claim, not two different ones —
-- the original comparison serialized jsonb directly, which is
-- order-sensitive).
create or replace function public.catalog_person_normalize_value(v jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when jsonb_typeof(v) = 'array' then (
      select string_agg(lower(btrim(elem)), '|' order by lower(btrim(elem)))
      from jsonb_array_elements_text(v) as elem
    )
    else lower(btrim(v #>> '{}'))
  end;
$$;

-- §C.2 — no is_test/is_internal exclusion in the org-count. The platform
-- already has this rule for every other piece of automatic business logic
-- (migration 0316); consensus was the one path that didn't join to it, so
-- test/internal orgs could auto-verify a global catalog field.
--
-- §C.3 (part 2) — the trigger now fires on UPDATE too, not just INSERT:
-- the new upsert above means an org changing its answer on a field is an
-- UPDATE, and if that change is what would tip a field to 3 distinct real
-- orgs, it has to be checked too. Safe against the function's own
-- consensus-reached UPDATE re-firing itself: that UPDATE sets
-- status='verified', and the function's first line already returns
-- immediately for any row whose status isn't 'submitted' — confirmed by
-- reading the guard clause, not just assumed.
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

  v_norm_value := public.catalog_person_normalize_value(new.value);
  if coalesce(v_norm_value, '') = '' then return new; end if;

  select count(distinct c.org_id) into v_org_count
  from contributions c
  join orgs o on o.id = c.org_id
  where c.subject_type = 'catalog_person' and c.subject_id = new.subject_id and c.field = new.field
    and c.status in ('submitted', 'verified')
    and public.catalog_person_normalize_value(c.value) = v_norm_value
    and o.is_test = false and o.is_internal = false;

  if v_org_count < 3 then return new; end if;

  select verified_fields ->> new.field into v_current_level
  from catalog_people_research where person_id = new.subject_id;
  if v_current_level in ('verified_by_admin', 'verified_by_person') then return new; end if;

  update contributions
    set status = 'verified', reviewed_at = now(),
      reviewer_notes = trim(both ' · ' from coalesce(reviewer_notes || ' · ', '')
        || 'Auto-verified: ' || v_org_count || ' startups agree.')
    where subject_type = 'catalog_person' and subject_id = new.subject_id and field = new.field
      and status = 'submitted' and public.catalog_person_normalize_value(value) = v_norm_value;

  perform public.catalog_person_apply_field(new.subject_id, new.field, new.value, 'verified_by_startups');

  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (
    null, 'catalog_person_consensus_auto_verify', 'catalog_person', new.subject_id,
    jsonb_build_object('field', new.field, 'value', new.value, 'org_count', v_org_count)
  );

  return new;
end;
$$;

drop trigger if exists trg_catalog_person_check_consensus on public.contributions;
create trigger trg_catalog_person_check_consensus
  after insert or update on public.contributions
  for each row execute function public.catalog_person_check_consensus();

-- Defensive re-assert, same reasoning as 0324/0325: create or replace
-- function does not change an existing function's ACL, but this is
-- cheap insurance against ever relying on that silently.
revoke execute on function public.catalog_person_apply_field(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.people_contribute_to_catalog() from public, anon, authenticated;
revoke execute on function public.catalog_person_contribute(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.catalog_person_check_consensus() from public, anon, authenticated;
