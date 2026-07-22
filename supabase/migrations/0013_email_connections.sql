-- IRM_SPEC §8d — per-founder Gmail OAuth pairing so the composer can send
-- from the founder's own mailbox. Tokens are encrypted at rest by the app
-- (AES-256-GCM, src/lib/crypto.ts) BEFORE they ever reach this table —
-- Postgres just stores opaque base64 blobs. RLS scopes each row strictly to
-- its own user (not just org) since these are personal mailbox credentials,
-- not org-shared data.

create table email_connections (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'gmail',
  email_address text not null,
  access_token_enc text not null,
  refresh_token_enc text not null,
  token_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table email_connections enable row level security;
create policy email_connections_own on email_connections for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create index on email_connections (org_id);
