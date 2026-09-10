-- Prompt 585 Phase 5 — §F.9's measurement table + the one column §G.3's
-- "No-link verdicts" list needs that Phase 4 didn't persist.
--
-- reason_if_none was deliberately left out of hook_suggestions in Phase 4
-- (the prompt's own §F.5 field list for that table doesn't mention it),
-- but §G.3 explicitly asks for a back-office list showing it per row —
-- that list is unbuildable without somewhere to read it from. Additive,
-- nullable column; no backfill needed (every existing 'none' row from
-- Phase 4's own testing was a zz-test fixture, already destroyed).
alter table public.hook_suggestions add column if not exists reason_if_none text;

-- §F.9 — "escrita quando o founder envia... com hook usado ou não;
-- replied_at preenchido pela thread de Messages quando há resposta na
-- plataforma." Only ever written from postMessage() (src/lib/deal-
-- messages.ts), the one real place both a founder send and an investor
-- reply already flow through — never a second, independent write path.
--
-- thread_id is not in the prompt's own literal column list but is the
-- necessary correlation key for "a reply on THIS thread closes THIS
-- outcome" — without it there is no way to know which sent message a
-- reply answers. Nullable/on delete set null: an outcome row survives a
-- thread's own deletion (which doesn't happen in practice, but the
-- measurement row shouldn't disappear if it ever did).
--
-- replied_at can only ever be filled for channel='platform_message' —
-- the platform has no observable signal for a reply to an email/
-- LinkedIn/form outreach, so those rows stay open forever, honestly (no
-- fabricated "replied" for a channel the app can't see into).
create table public.contact_outcomes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_id uuid not null references public.catalog_entities(id) on delete cascade,
  person_id uuid references public.catalog_people(id) on delete set null,
  channel public.hook_channel not null,
  hook_suggestion_id uuid references public.hook_suggestions(id) on delete set null,
  thread_id uuid references public.deal_threads(id) on delete set null,
  sent_at timestamptz not null default now(),
  replied_at timestamptz,
  outcome text,
  created_at timestamptz not null default now()
);

create index contact_outcomes_org_idx on public.contact_outcomes (org_id, sent_at desc);
create index contact_outcomes_thread_open_idx on public.contact_outcomes (thread_id) where replied_at is null;
create index contact_outcomes_hook_suggestion_idx on public.contact_outcomes (hook_suggestion_id) where hook_suggestion_id is not null;

alter table public.contact_outcomes enable row level security;
create policy contact_outcomes_read on public.contact_outcomes for select
  using (is_platform_admin() or is_org_member(org_id));
-- No client write policy — written only from postMessage(), which always
-- runs on the service-role client (same as deal_messages/deal_threads
-- themselves, migration 0126: RLS enabled, zero client policies).
revoke all on public.contact_outcomes from anon, authenticated;
grant select on public.contact_outcomes to authenticated;
