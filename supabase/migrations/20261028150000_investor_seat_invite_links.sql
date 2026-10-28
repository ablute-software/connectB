-- Prompt 923 (B, 28/10/2026) — a seat invitation gets a link of its own, and the administrator can see what happened to it. Additive only.
-- APPLIED 28/10/2026 to wkjcaoqdvhykrfacsylr (ledger version 20261028155222, name investor_seat_invite_links) after a dry run (a transaction that was rolled back).
--
-- Until now an invitation was only "a seat reserved for an email": the email told the person to sign up, search for the firm and claim its profile. The link in it went to /login, which opened the FOUNDER registration for a
-- new person (28/10/2026, the +aval1 case). Now every invitation has an unguessable `token`; the link /invite/seat/<token> opens an investor registration tied to it (only the email, locked, the 6-digit code, the name and the role).
--
--   token          64 hex characters (two random uuids, no dashes). A bearer link: whoever has it can open the page, but only the signed-in account whose CONFIRMED email is the invited one can accept.
--   failure_reason why the last attempt to accept could not be completed ("This account already belongs to «X»…"), for the administrator. The invitation stays OPEN and is not spent.
--   failed_at      when.
-- The invitations that already exist get a token too (the administrator can send them the new link: "Send the link again").
alter table public.investor_firm_seat_invites add column if not exists token text;
alter table public.investor_firm_seat_invites add column if not exists failure_reason text;
alter table public.investor_firm_seat_invites add column if not exists failed_at timestamptz;

update public.investor_firm_seat_invites set token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') where token is null;
alter table public.investor_firm_seat_invites alter column token set default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
create unique index if not exists investor_firm_seat_invites_token_uq on public.investor_firm_seat_invites (token);

-- The history gets the three new moments of an invitation.
do $chk$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.investor_seat_events'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%seat_granted%'
  loop
    execute format('alter table public.investor_seat_events drop constraint %I', c.conname);
  end loop;
  alter table public.investor_seat_events add constraint investor_seat_events_event_check check (event in (
    'seat_granted', 'seat_released', 'plan_set', 'plan_ended', 'admin_changed',
    'invite_created', 'invite_cancelled', 'claim_approved', 'claim_declined',
    'code_created', 'code_redeemed', 'code_revoked', 'code_deleted',
    'invite_accepted', 'invite_failed', 'invite_resent'));
end
$chk$;
