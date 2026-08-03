-- Prompt 103 Bloco 2 — Vault Data Room 4-digit PIN gate, per user, on top
-- of the existing role-level data_room_read capability. pgcrypto confirmed
-- already active. pin_hash is never selectable by the client (column-level
-- grant below excludes it) and every write/verify goes through a
-- security-definer RPC — the client never sees or constructs a hash.
create table public.vault_data_room_pins (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pin_hash text,
  pin_skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
alter table public.vault_data_room_pins enable row level security;

create policy vault_pins_select on public.vault_data_room_pins
  for select using (user_id = auth.uid() and public.is_org_member(org_id));

-- No insert/update/delete policy and no table-level grant at all — every
-- write happens through the SECURITY DEFINER functions below, which run as
-- the function owner regardless of the caller's own table privileges.
revoke all on public.vault_data_room_pins from authenticated, anon;
grant select (id, org_id, user_id, pin_skipped, created_at, updated_at) on public.vault_data_room_pins to authenticated;

create or replace function public.vault_pin_status(p_org_id uuid)
returns table(has_pin boolean, pin_skipped boolean)
language sql security definer set search_path to 'public'
as $function$
  select (pin_hash is not null), pin_skipped
  from public.vault_data_room_pins
  where org_id = p_org_id and user_id = auth.uid();
$function$;
grant execute on function public.vault_pin_status(uuid) to authenticated;

create or replace function public.vault_pin_set(p_org_id uuid, p_pin text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.is_org_member(p_org_id) then raise exception 'not a member of this org'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be exactly 4 digits'; end if;
  insert into public.vault_data_room_pins (org_id, user_id, pin_hash, pin_skipped, updated_at)
  values (p_org_id, auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf')), false, now())
  on conflict (org_id, user_id) do update set pin_hash = excluded.pin_hash, pin_skipped = false, updated_at = now();
end;
$function$;
grant execute on function public.vault_pin_set(uuid, text) to authenticated;

create or replace function public.vault_pin_skip(p_org_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.is_org_member(p_org_id) then raise exception 'not a member of this org'; end if;
  insert into public.vault_data_room_pins (org_id, user_id, pin_hash, pin_skipped, updated_at)
  values (p_org_id, auth.uid(), null, true, now())
  on conflict (org_id, user_id) do update set pin_hash = null, pin_skipped = true, updated_at = now();
end;
$function$;
grant execute on function public.vault_pin_skip(uuid) to authenticated;

create or replace function public.vault_pin_verify(p_org_id uuid, p_pin text)
returns boolean language sql security definer set search_path to 'public' as $function$
  select coalesce(
    (select pin_hash = extensions.crypt(p_pin, pin_hash)
     from public.vault_data_room_pins
     where org_id = p_org_id and user_id = auth.uid() and pin_hash is not null),
    false
  );
$function$;
grant execute on function public.vault_pin_verify(uuid, text) to authenticated;

-- Owner-only reset: forces the first-entry screen again for everyone in the
-- org, including anyone who had previously dismissed it.
create or replace function public.vault_pin_reset_org(p_org_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.org_members where org_id = p_org_id and user_id = auth.uid() and role = 'owner') then
    raise exception 'owner only';
  end if;
  delete from public.vault_data_room_pins where org_id = p_org_id;
end;
$function$;
grant execute on function public.vault_pin_reset_org(uuid) to authenticated;
