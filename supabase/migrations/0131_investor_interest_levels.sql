-- P136 — the disclosure ladder (Nuno's decision C, addenda 2026-08-06).
-- Governs dossier FIELDS only — access_grants and the matching engine are
-- untouched; this table's own ladder ends exactly where access_grants
-- begins (level 4 = the existing NDA/grants flow, unaffected).
--
-- APPLY TOGETHER WITH 0132, THIS ONE FIRST, IMMEDIATELY AFTER — never apply
-- 0131 alone (relatorio_verificacao_..._8143c75_p136 §6). The app code has
-- since been hardened so a lone 0131 no longer leaves a permanently-stuck
-- task on the founder's own Today (requestInterestLevel no longer falls
-- back to an untagged task if 0132's tasks_source widening hasn't landed
-- yet — it just logs and skips), but 0132 is still meant to land in the
-- same breath: without it, every level-3 request silently creates no
-- founder-side task at all until 0132 is applied.
--
-- Level 1 is deliberately NOT a row here — it already exists as
-- investor_relationship_decisions' own 'interested' decision (AP-06,
-- irreversible by design). Materializing it a second time here would
-- create two places asserting the same fact, which could one day
-- disagree. Only levels 2 (instant, investor-initiated) and 3 (founder-
-- approved) live in this table — see src/lib/investor-interest-level.ts
-- for the full level-computation rule, including the mandatory collapse
-- to 0 on a 'passed' decision (checked in code, not here, since this
-- table has no visibility into investor_relationship_decisions itself).
--
-- share_direct_email lives on the level-3 ROW (not a separate org-wide
-- policy): the founder's own approval dialog for THIS firm's THIS request
-- is where that decision is made and stays auditable next to it. Default
-- false — an email is a copy, not a view (unlike everything else this
-- ladder governs), and it only ever leaves the app when a human said so
-- in words, once, for this specific firm.
--
-- Same pattern as 0125/0126/0130: RLS enabled, ZERO policies — every
-- read/write goes through service-role portal/founder routes only.
create table if not exists public.investor_interest_levels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  investor_catalog_entity_id uuid not null references public.catalog_entities(id) on delete cascade,
  level smallint not null check (level in (2, 3)),
  status text not null default 'granted' check (status in ('granted', 'pending', 'denied')),
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  note text,
  share_direct_email boolean not null default false,
  unique (org_id, investor_catalog_entity_id, level)
);
alter table public.investor_interest_levels enable row level security;
create index if not exists investor_interest_levels_firm_startup_idx
  on public.investor_interest_levels (investor_catalog_entity_id, org_id, level);
