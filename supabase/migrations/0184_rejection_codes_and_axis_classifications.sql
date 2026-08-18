-- Prompt 251/253 Bloco A — machine-comparable rejection codes, the
-- structured version of the reopen doctrine (migration 0016). Two tables:
--
-- rejection_codes: per-entity, per-axis. A pass can carry zero or more of
-- these — codifying is always optional (Prompt 251-B §1: the taxonomy is
-- illustrative, grows from real use, never invented ahead of it). Not a
-- replacement for interactions.pass_reason_category (the coarse 8-value
-- field) — the two coexist; this is the finer, comparable layer.
-- axis_code is free text on purpose (no CHECK/enum): the taxonomy has no
-- fixed set of axes and isn't supposed to get one — new axes appear by
-- being typed, not by a migration. required_level is the level an
-- investor needs to see before this stops being a blocker; level_label is
-- what that level actually means in words (comparable to nothing yet —
-- Bloco B is what compares it against the startup's own classification).
--
-- org_axis_classifications: the startup's own position on the same axes,
-- schema only for now (no reader/writer until Bloco B) — same "migration
-- lands before the feature that consumes it" sequencing already used for
-- company_claims (migration 0176, still 0 rows, Block 3 not built yet).
-- Confirmed values are append-only (never UPDATEd): a newer row for the
-- same axis supersedes the last one, mirroring company_facts'
-- superseded_by convention — this is how Bloco B's refresh detects "this
-- changed" without a separate version counter.
--
-- Root privacy rule: founder-private like the rest of the CRM pipeline
-- (pass reasons, codes on why an investor said no) — never investor-
-- visible. RLS mirrors interactions/company_claims exactly: is_org_member
-- for everyone on the org, no broader access.

create table rejection_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  axis_code text not null,
  required_level int not null,
  level_label text not null,
  source_interaction_id uuid references interactions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on rejection_codes (org_id, entity_id);
create index on rejection_codes (org_id, axis_code);

alter table rejection_codes enable row level security;
create policy rejection_codes_all on rejection_codes
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

create table org_axis_classifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  axis_code text not null,
  level int not null,
  level_label text not null,
  -- References company_facts, NOT company_claims (migration 0176) --
  -- different table, different purpose (narrative claims vs. canon
  -- facts); naming it source_fact_id instead of the proposal's looser
  -- "source_claim_id" to avoid exactly that confusion.
  source_fact_id uuid references company_facts(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on org_axis_classifications (org_id, axis_code, confirmed_at desc);

alter table org_axis_classifications enable row level security;
create policy org_axis_classifications_all on org_axis_classifications
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));
