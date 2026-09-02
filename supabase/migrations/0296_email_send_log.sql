-- Prompt 537 §1 — every send outcome recorded where a human can read it.
--
-- THE PROBLEM THIS TABLE EXISTS TO END. invite-by-email/route.ts logged the
-- provider's own reason to console.error (Vercel only) and returned the
-- founder a generic sentence ("Email sending failed — try again in a
-- moment."). Nobody in the loop can read Vercel logs, so the actual cause —
-- a 403 on an unverified sender domain, a missing key, a sandbox-recipient
-- refusal — was GUESSED AT for three weeks instead of read. Three prompts
-- were spent re-diagnosing a fact the provider had already stated.
--
-- So: one row per attempt, success or failure, carrying the exact `from`
-- that was used and the provider's verbatim response. From here on "the
-- email didn't arrive" is answered by selecting a row.
--
-- provider_error is capped at 500 chars in the writer (resend.ts) rather
-- than by a check constraint: a truncated diagnostic is still useful, but a
-- rejected INSERT would lose the very record this table exists to keep.
create table email_send_log (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references orgs(id) on delete set null,
  kind text not null check (kind in ('guest_invite', 'access_notify', 'access_grant', 'support', 'other')),
  recipient text not null,
  subject text,
  status text not null check (status in ('sent', 'failed', 'not_configured', 'render_failed')),
  provider_id text,
  provider_error text,
  from_address_used text,
  related_grant_id uuid references access_grants(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table email_send_log enable row level security;

-- Reads: an org's own members see their own org's rows; platform admins see
-- everything. Writes: service role only — every caller goes through
-- sendTransactionalEmail on the server, and a client that could insert here
-- could fake a delivery record.
create policy email_send_log_org_read on email_send_log for select
  using (org_id is not null and is_org_member(org_id));
create policy email_send_log_platform_admin on email_send_log for select
  using (is_platform_admin());

create index on email_send_log (created_at desc);
create index on email_send_log (org_id, created_at desc);
create index on email_send_log (status, created_at desc);
create index on email_send_log (related_grant_id);
create index on email_send_log (recipient, created_at desc);
