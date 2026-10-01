-- Prompt 746 Phase 1 — the investor's own Portfolio tab (a main sidebar
-- entry now, per Nuno's 30/09 decision — see INVESTOR_NAV). Replaces
-- investor_declared_investments (migration 0266): that table has 0 rows in
-- production and its only reader (declaredInvestmentToReopenRecord in
-- reopen-signals.ts) is imported solely by its own test — confirmed before
-- writing this, not assumed from the prompt's own claim. See the companion
-- migration 20260930121000 for its removal.
--
-- NOT applied to any live database by this session — a migration file only,
-- per CLAUDE.md ("Verifying a change in the browser" / migration discipline)
-- and this prompt's own explicit instruction: a live write needs Nuno's own
-- "sim" given directly in the orchestrating session. No Supabase MCP
-- apply_migration call was made to produce this file.
--
-- Scope is data only — Phase 1 never invites, verifies, or associates a
-- portfolio row with a real founder org. `linked_org_id`/`link_status`
-- are reserved columns for Phase 2 to fill in later; nothing in this
-- migration or the app writes them yet.
--
-- Firm-scoped, not per-member: a real investment is made by the FIRM, not
-- the individual person typing it in — same reasoning investor_declared_
-- investments' own header gave, and the same RLS shape as that table
-- (catalog_entity_id via matchdeal_investor_members, status='active'),
-- reused rather than reinvented. Renamed the FK column to
-- investor_catalog_entity_id (the prompt's own field name) to read clearly
-- next to a future founder-side org_id once Phase 2 adds linked_org_id.
create table public.investor_portfolio_companies (
  id uuid primary key default gen_random_uuid(),
  investor_catalog_entity_id uuid not null references public.catalog_entities(id) on delete cascade,

  status text not null default 'current' check (status in ('current', 'past')),

  company_name text not null check (btrim(company_name) <> ''),
  website text,
  -- Normalized at write time by the app (normalizeDomain() in catalog-
  -- dedupe.ts — lowercase, no leading "www."), the same helper the founder-
  -- side importer already uses for entity dedup. The check below is a
  -- cheap DB-side backstop for the "lowercase" half only; "no www." can't be
  -- expressed as a simple check constraint without duplicating that
  -- function's URL-parsing logic in SQL, so it stays an app-level guarantee.
  domain text check (domain is null or domain = lower(domain)),
  country text,

  -- Reuses the EXISTING `stage` enum (pre_seed/seed/series_a/series_b/
  -- series_c_plus/later/other) rather than a parallel check constraint —
  -- confirmed before writing this that 'other' was already added to it by
  -- migration 0037, so "orgs.stage's values plus other" (the prompt's own
  -- wording) is just orgs.stage's own type, unchanged.
  stage_at_entry public.stage,

  -- From the same canonical taxonomy SectorPicker/sector-taxonomy.ts already
  -- enforce client-side (no DB-side check against that list — every other
  -- sectors text[] column in this schema, e.g. entities.sectors, catalog_
  -- entities.sectors, leaves that to the app layer too).
  sectors text[] not null default '{}',

  ticket_eur bigint check (ticket_eur is null or ticket_eur >= 0),
  instrument text check (instrument is null or instrument in ('equity', 'safe', 'convertible_note', 'other')),
  invested_at date,

  -- Only meaningful for status='past' — enforced below, not just by
  -- convention, since a stray exit_at on a 'current' row would be a real
  -- data bug this constraint is cheap to prevent outright.
  exit_at date,
  exit_type text check (exit_type is null or exit_type in ('acquisition', 'ipo', 'write_off', 'other')),
  constraint investor_portfolio_companies_exit_only_when_past
    check (status = 'past' or (exit_at is null and exit_type is null)),

  -- Founder-privacy root rule (CLAUDE.md) applies in the OTHER direction
  -- here: ticket_eur/instrument/contact_name/contact_email are the
  -- investor's own private notes about a company they invested in — never
  -- founder- or publicly-visible. This table has no founder-side reader at
  -- all (no join from entities/orgs, no API route under a founder session
  -- can reach it), which is the actual enforcement; the RLS policy below is
  -- the second, independent gate.
  contact_name text,
  contact_email text,

  -- Phase 2 (Prompt 746, not this migration): the founder org this row gets
  -- provisionally/verifiedly linked to once invited. Both columns exist now
  -- so Phase 2 has somewhere to write without a schema change of its own;
  -- nothing in Phase 1 ever sets link_status past its default.
  linked_org_id uuid references public.orgs(id) on delete set null,
  link_status text not null default 'unlinked' check (link_status in ('unlinked', 'pending', 'linked', 'declined')),

  source text not null check (source in ('manual', 'import')),

  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index investor_portfolio_companies_firm_idx on public.investor_portfolio_companies (investor_catalog_entity_id, status);
-- Partial, not a full unique index — duplicate detection is an IMPORT-TIME
-- UX concern (portfolio-import.ts's detectDuplicates, run against this
-- exact set of columns), not a hard schema invariant: a firm might
-- legitimately hold two unrelated companies that happen to share a name
-- with no website on file. This index only makes that lookup (and the
-- future "same domain" backoffice audit) fast, it does not forbid the row.
create index investor_portfolio_companies_domain_idx on public.investor_portfolio_companies (investor_catalog_entity_id, domain) where domain is not null;

alter table public.investor_portfolio_companies enable row level security;

-- Same "armed but inert" grant fix already applied to deal_terms
-- (20260930105448, Review fix B) — with public-schema defaults, anon and
-- authenticated both get table-level grants the moment a table is created,
-- regardless of what RLS policies exist. Belt-and-braces here because this
-- table carries exactly the class of data (ticket, instrument, contact)
-- the founder-privacy root rule says must never leak: RLS is the real gate,
-- this is the second one. service_role needs nothing granted — it bypasses
-- RLS/grants everywhere in this schema already (rolbypassrls).
revoke all on public.investor_portfolio_companies from public, anon;
grant select, insert, update, delete on public.investor_portfolio_companies to authenticated;

-- Unlike deal_terms (append-only, no delete policy for anyone — a
-- negotiation term is history), a portfolio row is the investor's own
-- editable record of their own past investing, same as investor_declared_
-- investments before it: delete is a normal "remove what I added by
-- mistake" action, not something requiring an audit trail.
create policy investor_portfolio_companies_own_firm on public.investor_portfolio_companies for all
  using (
    investor_catalog_entity_id in (
      select catalog_entity_id from public.matchdeal_investor_members
      where user_id = auth.uid() and status = 'active'
    )
    or is_platform_admin()
  )
  with check (
    investor_catalog_entity_id in (
      select catalog_entity_id from public.matchdeal_investor_members
      where user_id = auth.uid() and status = 'active'
    )
    or is_platform_admin()
  );

comment on table public.investor_portfolio_companies is
  'Prompt 746 Phase 1 — an investor firm''s own portfolio (current + past), manually added or CSV/Excel-imported. Firm-scoped via matchdeal_investor_members, never founder- or publicly-readable. linked_org_id/link_status are reserved for Phase 2 (invite + verified association) and unused until then.';
