-- Prompt 118 §3 — Vault Data Room codes become owner-managed instead of a
-- self-service preference. PROPOSE ONLY, DO NOT APPLY without Nuno's
-- explicit "yes" — this is a real behavior change (vault_pin_skip currently
-- lets ANY org member self-exempt with one click; after this migration it
-- always raises) and the PeopleCard UI that depends on it (Prompt 118 §3.5)
-- is not built yet. Written now so both can ship together the moment this
-- is authorized — no code deploy needed beyond that UI work.
--
-- Root cause this migration fixes: vault_pin_skip(p_org_id) only checks
-- is_org_member(p_org_id) — any Admin or Member can dispense themselves
-- from the code with one click, same as the owner. Compare
-- vault_pin_reset_org, which correctly checks role = 'owner'. That
-- asymmetry means today's "code" is a personal preference each person
-- toggles, never an org-imposed control — this migration is what makes it
-- one. Also fixes: vault_pin_verify has no rate limit (4 digits = 10,000
-- combinations, exhaustible in minutes); acceptable while the code was a
-- personal preference, not once an owner can mandate it.
--
-- pin_skipped is NOT dropped (avoids a destructive migration) but stops
-- being read by any RPC below — "no code" is now exactly
-- required_by_owner = false, matching what the owner actually set. Marked
-- for removal in a future cleanup migration once nothing reads it.

alter table public.vault_data_room_pins
  add column if not exists required_by_owner boolean not null default false,
  add column if not exists set_by            uuid references auth.users(id),
  add column if not exists set_by_owner_at   timestamptz,
  add column if not exists failed_attempts   integer not null default 0,
  add column if not exists locked_until      timestamptz;

-- Day 1, zero impact: nobody becomes suddenly required to enter a code.
update public.vault_data_room_pins set required_by_owner = false;

-- (1) Close the self-exemption hole. Not `drop function` — during a deploy
-- window, tabs still open with the old client would call it and get a
-- confusing 404 instead of a clear message.
create or replace function public.vault_pin_skip(p_org_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  raise exception 'Vault Data Room codes are set by the organisation owner.';
end;
$function$;

-- (2) The owner sets a member's code. Generates server-side is NOT enforced
-- here (the owner could type any 4 digits) — the UI's "Generate" button is
-- the actual defense against code reuse; ownership only enforces the shape.
create or replace function public.vault_pin_set_for_user(p_org_id uuid, p_user_id uuid, p_pin text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.org_members
                 where org_id = p_org_id and user_id = auth.uid() and role = 'owner') then
    raise exception 'owner only';
  end if;
  if not exists (select 1 from public.org_members
                 where org_id = p_org_id and user_id = p_user_id) then
    raise exception 'not a member of this org';
  end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'code must be exactly 4 digits'; end if;

  insert into public.vault_data_room_pins
    (org_id, user_id, pin_hash, pin_skipped, required_by_owner, set_by, set_by_owner_at,
     failed_attempts, locked_until, updated_at)
  values
    (p_org_id, p_user_id, extensions.crypt(p_pin, extensions.gen_salt('bf')), false, true,
     auth.uid(), now(), 0, null, now())
  on conflict (org_id, user_id) do update set
    pin_hash = excluded.pin_hash, pin_skipped = false, required_by_owner = true,
    set_by = excluded.set_by, set_by_owner_at = now(),
    failed_attempts = 0, locked_until = null, updated_at = now();
end;
$function$;

-- (3) The owner clears a member's code (= the empty-field state in §3.5).
create or replace function public.vault_pin_clear_for_user(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.org_members
                 where org_id = p_org_id and user_id = auth.uid() and role = 'owner') then
    raise exception 'owner only';
  end if;
  update public.vault_data_room_pins
     set pin_hash = null, required_by_owner = false, pin_skipped = false,
         failed_attempts = 0, locked_until = null, set_by = auth.uid(),
         set_by_owner_at = now(), updated_at = now()
   where org_id = p_org_id and user_id = p_user_id;
end;
$function$;

-- (4) The owner reads state for the whole org — never the code itself.
-- pin_hash never leaves this function; the list exposes has_pin (boolean)
-- only, same principle as the existing column-level grant on the table.
create or replace function public.vault_pin_list(p_org_id uuid)
returns table (user_id uuid, has_pin boolean, required boolean,
               set_by_owner_at timestamptz, locked_until timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.org_members
                 where org_id = p_org_id and user_id = auth.uid() and role = 'owner') then
    raise exception 'owner only';
  end if;
  return query
    select m.user_id,
           coalesce(p.pin_hash is not null, false),
           coalesce(p.required_by_owner, false),
           p.set_by_owner_at, p.locked_until
      from public.org_members m
      left join public.vault_data_room_pins p
             on p.org_id = m.org_id and p.user_id = m.user_id
     where m.org_id = p_org_id;
end;
$function$;

-- (5) vault_pin_status's return shape changes (adds `required`/`locked_until`,
-- drops `pin_skipped` from the public contract) — CREATE OR REPLACE cannot
-- change a function's return columns, so this one needs an explicit drop.
-- `required` is only ever true when a hash actually exists: a row with
-- required_by_owner = true and pin_hash = null would lock a user out with
-- no way back in. vault_pin_set_for_user always writes both together, but
-- the defense belongs on the read side too, not just the write side.
drop function if exists public.vault_pin_status(uuid);
create function public.vault_pin_status(p_org_id uuid)
returns table(required boolean, has_pin boolean, locked_until timestamptz)
language sql security definer set search_path to 'public'
as $function$
  select coalesce(required_by_owner and pin_hash is not null, false),
         (pin_hash is not null),
         locked_until
  from public.vault_data_room_pins
  where org_id = p_org_id and user_id = auth.uid();
$function$;
grant execute on function public.vault_pin_status(uuid) to authenticated;

-- (6) Rate limiting: 5 failed attempts locks for 15 minutes. Locked-out
-- checked before comparing, so a locked user can't burn more attempts
-- probing. Success clears both counters; the owner can also unlock early
-- via vault_pin_set_for_user (which already resets both fields).
create or replace function public.vault_pin_verify(p_org_id uuid, p_pin text)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare
  v_row public.vault_data_room_pins%rowtype;
  v_ok boolean;
begin
  select * into v_row from public.vault_data_room_pins
   where org_id = p_org_id and user_id = auth.uid();

  if v_row.locked_until is not null and v_row.locked_until > now() then
    raise exception 'too many attempts';
  end if;

  if v_row.pin_hash is null then
    return false;
  end if;

  v_ok := (v_row.pin_hash = extensions.crypt(p_pin, v_row.pin_hash));

  if v_ok then
    update public.vault_data_room_pins
       set failed_attempts = 0, locked_until = null, updated_at = now()
     where org_id = p_org_id and user_id = auth.uid();
  else
    update public.vault_data_room_pins
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end,
           updated_at = now()
     where org_id = p_org_id and user_id = auth.uid();
  end if;

  return v_ok;
end;
$function$;
grant execute on function public.vault_pin_verify(uuid, text) to authenticated;

-- (7) vault_pin_reset_org's SQL body is unchanged (already owner-only,
-- already the right operation — deleting every row in the org clears
-- required_by_owner along with everything else). Only its meaning and the
-- calling UI's button copy change (§3.7, held with the rest of §3.5's UI
-- work): "Clear all codes (no one will be asked)" instead of "Reset all
-- Vault Data Room codes".

grant execute on function public.vault_pin_set_for_user(uuid, uuid, text) to authenticated;
grant execute on function public.vault_pin_clear_for_user(uuid, uuid) to authenticated;
grant execute on function public.vault_pin_list(uuid) to authenticated;
