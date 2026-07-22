-- BLOCO 3 — back-office console. Two additive tables:
--
-- admin_audit_log: every admin mutation (verify/reject/merge/delete/GDPR
-- resolution) writes here — the "who did what, when, based on what" record
-- the console promises. Promotions to public catalog record provenance
-- (which contributions, who verified) in `detail`.
--
-- entity_aliases: backs the catalog_entities duplicate-merge tool (§9b-3a —
-- "MAZE (Mustard Seed MAZE)" == "MAZE"; "Bynd Venture Capital" == "Bynd" ==
-- "Busy Angels SCR"). Scoped to catalog_entities for this pass — the same
-- table can back org-level import matching later (§9 full pipeline) by
-- joining through catalog_entities, but that integration isn't built yet.

create table admin_audit_log (
  id uuid primary key default uuid_generate_v4(),
  admin_user_id uuid references auth.users(id),
  action text not null,
  subject_type text not null,
  subject_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table admin_audit_log enable row level security;
create policy admin_audit_log_admin on admin_audit_log for all
  using (is_platform_admin()) with check (is_platform_admin());
create index on admin_audit_log (created_at desc);
create index on admin_audit_log (subject_type, subject_id);

create table entity_aliases (
  id uuid primary key default uuid_generate_v4(),
  catalog_id uuid not null references catalog_entities(id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  unique (catalog_id, alias)
);
alter table entity_aliases enable row level security;
create policy entity_aliases_read on entity_aliases for select using (true);
create policy entity_aliases_admin on entity_aliases for all
  using (is_platform_admin()) with check (is_platform_admin());
create index on entity_aliases (alias);
