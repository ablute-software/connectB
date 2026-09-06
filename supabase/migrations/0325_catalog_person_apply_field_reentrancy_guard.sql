-- Prompt 581 §D fix — found live, via the prompt's own required fixture
-- (3 orgs agree -> auto-verify): catalog_person_apply_field's own
-- reverse-sync write (§D.5, "orgs with nothing of their own start
-- showing the catalog's value") is a plain `update people set role = ...`
-- — and that's the SAME statement shape trg_people_contribute_to_catalog
-- watches for. Running the fixture end-to-end produced a 4th
-- contributions row, "Auto-verified: 4 startups agree", from an org that
-- never typed anything — the reverse-sync's own write fired the
-- auto-contribute trigger on itself. Harmless to the immediate consensus
-- math here (the value already matched), but it fabricates an audit
-- trail entry for an org that made no independent claim, which is exactly
-- what a consensus system's integrity depends on not happening.
--
-- Fixed with a transaction-local GUC flag: catalog_person_apply_field
-- sets it around its own `people` writes, and
-- people_contribute_to_catalog bails out immediately when it's set. A
-- founder's own real edit never sets this flag, so their trigger path is
-- unchanged.
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

  perform set_config('catalog_person.reverse_sync', 'on', true);

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
    perform set_config('catalog_person.reverse_sync', 'off', true);
    return;
  end if;

  perform set_config('catalog_person.reverse_sync', 'off', true);

  update catalog_people_research
    set verified_fields = verified_fields || jsonb_build_object(p_field, p_level)
    where person_id = p_person_id;
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
  if coalesce(current_setting('catalog_person.reverse_sync', true), 'off') = 'on' then return new; end if;

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

revoke execute on function public.catalog_person_apply_field(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.people_contribute_to_catalog() from public, anon, authenticated;
