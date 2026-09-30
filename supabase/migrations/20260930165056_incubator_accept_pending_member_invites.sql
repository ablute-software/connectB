-- Prompt I-01c §A.2 — the safety net for someone who was invited to an
-- ecosystem organisation's team but comes in through the ordinary door
-- (normal sign-in, or an e-mail confirmation link that did not bring them
-- back to the invite). Nuno's production test, 30/09/2026 17:13–17:16: such
-- an account was treated as an orphan founder, filled "finish your startup
-- account", got an org, and resolved as founder — the member invite stayed
-- 'invited' forever.
--
-- NOT applied by the session that wrote it; apply only with Nuno's "sim", and
-- rename the file to the version apply_migration records.
--
-- A CONFIRMED e-mail is sufficient proof here: the invite token only ever
-- proved possession of that same mailbox. The token path
-- (incubator_accept_member_invite) stays as it is.

create or replace function public.incubator_accept_pending_member_invites()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_m record;
  v_ids uuid[] := '{}';
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'incubator_ids', '[]'::jsonb);
  end if;
  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  if v_email is null or v_confirmed is null then
    return jsonb_build_object('ok', true, 'accepted', 0, 'incubator_ids', '[]'::jsonb);
  end if;

  for v_m in
    select m.* from incubator_members m
    join incubators i on i.id = m.incubator_id
    where m.status = 'invited'
      and lower(m.invited_email) = v_email
      and i.closed_at is null
      and (m.invite_expires_at is null or m.invite_expires_at > now())
    for update of m
  loop
    -- Same handling as incubator_accept_member_invite: an existing row for
    -- this user in the same incubator (e.g. removed earlier) is reactivated
    -- instead of tripping the (incubator_id, user_id) unique index.
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
    v_ids := v_ids || v_m.incubator_id;
  end loop;

  return jsonb_build_object('ok', true, 'accepted', coalesce(array_length(v_ids, 1), 0), 'incubator_ids', to_jsonb(v_ids));
end $$;

revoke execute on function public.incubator_accept_pending_member_invites() from public, anon, authenticated;
grant execute on function public.incubator_accept_pending_member_invites() to authenticated;
