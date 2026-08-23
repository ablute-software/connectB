-- Prompt 326 — badges/emblemas de prémios e marcos, com verificação de
-- autenticidade por AI. RLS: the founder's own org reads/writes their own
-- badges directly (same is_org_member pattern as company_claims, migration
-- 0176) — investor-facing reads go through a service-role route
-- (investors are never org_members, same posture as every other
-- investor-facing surface in this app).
create table if not exists company_badges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 500),
  year int check (year is null or year between 1900 and 2100),
  logo_storage_path text,
  -- Nullable FK to the Vault's own documents table — the founder's optional
  -- evidence attachment. on delete set null: removing the source document
  -- later never cascades into silently deleting the badge itself.
  evidence_document_id uuid references documents(id) on delete set null,
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed')),
  verification_note text,
  -- Pedido C — the "cheapest option that doesn't lose information": a
  -- simple, optional cross-reference to an existing company_claims row
  -- describing the SAME fact (Prompt 311's own evidence_class=5 "decoration"
  -- claims), set only when the founder confirms the dedup match this
  -- prompt's own findMatchingClaimForBadge surfaces at creation time. Never
  -- promotes the badge to a claim source, never duplicates the claim's own
  -- text here.
  linked_claim_id uuid references company_claims(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists company_badges_org_idx on company_badges (org_id);

alter table company_badges enable row level security;
create policy company_badges_org_members on company_badges
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));
