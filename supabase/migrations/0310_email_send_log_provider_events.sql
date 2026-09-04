-- Prompt 557 §3 — "sent" stops meaning "delivered".
--
-- Numbered 0310, not 0309. It was written and applied as 0309 after a sweep
-- that showed 0308 as the highest taken; `main` then merged
-- 0309_outreach_supply_includes_delivered_and_close_leak from another
-- workstream. Mine renumbers because theirs is already ON main and this one
-- is still on a branch — main is the tiebreaker, as DECISIONS.md records
-- after the 0293 and 0303 collisions. The rename is safe on its own terms:
-- the SQL is already applied to production under the Supabase migration name
-- `email_send_log_provider_events`, and the repo file is the record, not the
-- trigger. This is the third such collision; re-sweeping immediately before
-- a push is necessary but still cannot see a branch that merges after it.
--
-- Six guest_invite sends to the same @hotmail.com address today are all
-- `status = 'sent'` with a provider id: Resend accepted every one of them.
-- Nobody received any of them. That is not a contradiction — `sent` in this
-- table has only ever meant "the provider's API returned 200 for our
-- request", which is the last thing the app learns synchronously. Everything
-- after that (the receiving MX accepting or refusing, a spam verdict, a
-- bounce hours later) arrives asynchronously, and this table had no way to
-- hear it. So the one screen built to answer "did the email arrive?" was
-- structurally unable to.
--
-- Four statuses are added, all provider-reported, and one timestamp saying
-- WHEN the provider said it. `sent` keeps its exact meaning — accepted by
-- the provider — and is now the FIRST state rather than the last, which is
-- why nothing about the existing writer changes.
--
-- The Microsoft failure itself is a DNS problem, not an app one, and is not
-- fixable from here: send.sherlockdeal.com publishes TWO SPF TXT records
-- (Resend's `include:amazonses.com` plus a leftover GoDaddy
-- `_spfm.send.sherlockdeal.com` forwarding record), which is a PermError
-- under RFC 7208 §4.6.4 — every receiver must treat SPF as failed. Gmail and
-- Proton fall back to DKIM alignment and deliver; Outlook.com does not, for
-- a young sending domain. Deleting the GoDaddy record is Nuno's five-minute
-- job in DNS. What this migration buys is that the NEXT time this happens,
-- the answer is a row rather than three weeks of guessing.
alter table email_send_log drop constraint if exists email_send_log_status_check;
alter table email_send_log add constraint email_send_log_status_check
  check (status in (
    -- Synchronous, written by sendTransactionalEmail at the moment of the call.
    'sent', 'failed', 'not_configured', 'render_failed',
    -- Asynchronous, written by /api/resend/webhook from the provider's own
    -- events. A row only ever moves FORWARD from 'sent' into one of these.
    'delivered', 'bounced', 'complained', 'delayed'
  ));

-- When the provider reported the asynchronous outcome, as the provider
-- timestamped it — not when we processed the webhook. Null for a row that
-- has only ever been through the synchronous path.
alter table email_send_log add column if not exists provider_event_at timestamptz;

comment on column email_send_log.provider_event_at is
  'When Resend reported the delivery outcome (its own event timestamp, not our processing time). Null until a webhook lands. See migration 0309.';

-- The webhook looks a row up by the provider id Resend echoes back; without
-- this every delivery event is a sequential scan of the whole table.
create index if not exists email_send_log_provider_id_idx on email_send_log (provider_id) where provider_id is not null;
