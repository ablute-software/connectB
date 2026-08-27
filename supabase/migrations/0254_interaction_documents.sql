-- Prompt 397 §C.3 — N attachments per logged interaction. interactions.
-- document_id (migration 0001) is singular; RailLogForm's ATTACHMENTS
-- section (Log mode of the entity page's conversation panel) can attach
-- more than one Vault document or folder to a single interaction.
--
-- document_id/folder_id mirror access_grants' own shape (0001): exactly one
-- of the two set per row, rather than a single polymorphic column plus a
-- redundant `kind` flag that could drift out of sync with which FK is
-- actually populated. org_id is denormalized (not derived via a join to
-- interactions, unlike access_request_items/0243) because this table is
-- loaded client-side into the always-on `Db` object alongside every other
-- org-scoped table in store-supabase.tsx's loadAll, which filters every
-- table by `.eq('org_id', orgId)` directly — matching that convention keeps
-- the load a plain flat query instead of a special-cased join.
create table if not exists interaction_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  interaction_id uuid not null references interactions(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  folder_id uuid references folders(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint interaction_documents_one_target check (
    (document_id is not null and folder_id is null) or (document_id is null and folder_id is not null)
  )
);

create index if not exists interaction_documents_interaction_idx on interaction_documents(interaction_id);
create index if not exists interaction_documents_org_idx on interaction_documents(org_id);

alter table interaction_documents enable row level security;

drop policy if exists interaction_documents_all on interaction_documents;
create policy interaction_documents_all on interaction_documents
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table interaction_documents is
  'Prompt 397 §C.3 — N attachments (Vault documents or folders) per logged interaction. document_id/folder_id mirror access_grants: exactly one set per row. interactions.document_id keeps carrying the FIRST document attachment for back-compat.';
