-- Prompt 252 — audit trail for manual interaction edits (occurred_at,
-- channel, content). Requisito explícito do Nuno: quem editou, quando, e o
-- valor anterior.
--
-- One row per (interaction, field) changed, not one column-pair per
-- editable field bolted onto `interactions` (which only scales to exactly
-- the fields anticipated today) — a generic small table handles any future
-- editable field with zero schema change, and a full history if the same
-- field gets corrected twice.
--
-- edited_by is nullable + on delete set null (matches created_by/
-- confirmed_by elsewhere in this schema): in demo mode there is no
-- auth.users row at all, so the app writes the literal string 'demo'
-- there — never a fabricated identity — and that value only ever exists
-- client-side (demo mode has no real Postgres connection to violate this
-- column's FK). Real (Supabase-backed) edits always carry the actual
-- editor's auth.users id.
create table interaction_edits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  interaction_id uuid not null references interactions(id) on delete cascade,
  field text not null check (field in ('occurred_at', 'channel', 'content')),
  old_value text,
  new_value text,
  edited_by uuid references auth.users(id) on delete set null,
  edited_at timestamptz not null default now()
);
create index on interaction_edits (org_id, interaction_id, edited_at desc);

alter table interaction_edits enable row level security;
create policy interaction_edits_all on interaction_edits
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));
