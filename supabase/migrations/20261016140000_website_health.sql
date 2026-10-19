-- Prompt 919 — website health: Google's public PageSpeed / Lighthouse scores for a founder's own website, a plain-language AI summary
-- (charged), and a founder's opt-in to show the four scores to investors.
--
-- NOT YET APPLIED to production: waiting for Nuno's "sim". Rehearsed against production data inside ONE DO statement that always ends in
-- RAISE EXCEPTION (scripts/verify-website-health-919.sql, which embeds THIS file verbatim, so the rehearsal can never drift from what is
-- applied).
--
-- WHAT IT DOES
--   1. org_website_audits — one row per website analysis AND strategy (an analysis is a mobile row plus a desktop row, written together):
--      the four category scores (0-100), the three web-vitals numbers, and ONLY the essential findings (audits jsonb: the failed audits of
--      SEO / best practices / accessibility plus the five largest performance ones — never Lighthouse's whole JSON, which is hundreds of
--      KB). A failed analysis is a row with null scores and audits = {"error": {...}}. The AI summary (summary, summary_model,
--      summary_credits) lives on the mobile row it summarises.
--      Row level security: org members READ their own rows; nobody writes through the API (no insert/update/delete grant at all) — only the
--      service role, from our routes. An investor is not a member of the org and never reads this table: what an investor may see is
--      assembled on the server (four scores + date + link, only when orgs.website_score_visible), never selected from here wholesale.
--   2. orgs.website_score_visible — the founder's opt-in, OFF for everyone by default.
--   3. ai_actions gets 'website_summary' (2 credits) so charge_ai_action() meters it and Backoffice > AI credits & plans shows and edits it
--      like every other action. ON CONFLICT DO NOTHING: a row someone already edited is never overwritten. The Google analysis itself is
--      free and is never charged.
--
-- Fully additive: one new table, one new column, one new row. Nothing existing is changed.

-- 1. the analyses
create table if not exists public.org_website_audits (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid        not null references public.orgs(id) on delete cascade,
  url                  text        not null check (char_length(url) <= 2000),
  strategy             text        not null check (strategy in ('mobile', 'desktop')),
  score_performance    integer     check (score_performance    between 0 and 100),
  score_seo            integer     check (score_seo            between 0 and 100),
  score_accessibility  integer     check (score_accessibility  between 0 and 100),
  score_best_practices integer     check (score_best_practices between 0 and 100),
  lcp_ms               integer     check (lcp_ms >= 0),
  cls                  numeric(8, 4) check (cls >= 0),
  inp_ms               integer     check (inp_ms >= 0),
  -- the essentials only: the table refuses anything near a full Lighthouse report
  audits               jsonb       not null default '{}'::jsonb check (octet_length(audits::text) <= 60000),
  fetched_at           timestamptz not null default now(),
  summary              text        check (char_length(summary) <= 20000),
  summary_model        text        check (char_length(summary_model) <= 100),
  summary_credits      integer     check (summary_credits >= 0)
);
create index if not exists org_website_audits_org_fetched_idx on public.org_website_audits (org_id, fetched_at desc);

alter table public.org_website_audits enable row level security;
revoke all on public.org_website_audits from public, anon, authenticated;
grant select on public.org_website_audits to authenticated;
create policy org_website_audits_member_read on public.org_website_audits
  for select to authenticated using (public.is_org_member(org_id));

-- 2. the founder's opt-in: off until the founder turns it on
alter table public.orgs add column if not exists website_score_visible boolean not null default false;

-- 3. the action the wallet meters (the summary only; the Google analysis is free)
insert into public.ai_actions (key, label, category, credit_cost, needs_confirmation, enabled)
values ('website_summary', 'Website health — plain-language summary', 'client', 2, false, true)
on conflict (key) do nothing;
