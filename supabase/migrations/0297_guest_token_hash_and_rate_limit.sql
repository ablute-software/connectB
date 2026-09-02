-- Prompt 537 §4 — the guest link, hardened without breaking live links.
--
-- What was already sound and is deliberately NOT changed: 32 random bytes
-- base64url (generateRawToken), expiry bound to the grants' own expires_at
-- with a 14-day fallback, confirmed_at and revoked_at both invalidating,
-- and a guest route that returns folder/document NAMES only — never a
-- signed URL, never content. The real unlock still only ever reaches the
-- invited mailbox via OTP.
--
-- §4.1 — STORE THE HASH, NOT THE TOKEN. Today access_grants.guest_token
-- holds the raw link secret, so anyone who can read the row can open the
-- link: a database export, a backup, a support screenshot of a row, or any
-- future query that selects '*' and logs it. The token is a bearer
-- credential and bearer credentials belong in the database as hashes, the
-- same way matchdeal_pairing_tokens already stores token_hash (sha256 hex)
-- rather than the raw value.
--
-- TRANSITION, and why the raw column survives this migration: every live
-- link in production was minted before this change and exists ONLY as the
-- raw value — hashing it now is fine (sha256 is computable from the raw we
-- still hold), but a founder may also have pasted that URL into an email
-- that is already sent. So this migration BACKFILLS the hash for every
-- existing row, the route accepts a raw match as a fallback, and the raw
-- column is dropped in a later migration once the last live token has
-- expired (all current ones expire by 2026-09-30). Dropping it here would
-- silently break links already in recipients' inboxes.
alter table access_grants add column if not exists guest_token_hash text;

-- Backfill: the hash of every token that already exists. Schema-qualified as
-- `extensions.digest` because that is where Supabase installs pgcrypto in
-- this project (verified: pg_extension shows pgcrypto in schema
-- `extensions`, not `public`) — an unqualified digest() fails here.
-- encode(..., 'hex') matches hashToken()'s output in matchdeal-pairing.ts
-- byte for byte, so a row hashed here and a row hashed by the application
-- are indistinguishable.
update access_grants
set guest_token_hash = encode(extensions.digest(guest_token, 'sha256'), 'hex')
where guest_token is not null and guest_token_hash is null;

-- Not unique: two grants for the same recipient can legitimately share a
-- token (ensureGuestToken hands the SAME live token back rather than
-- rotating it), which is the behaviour Prompt 530 §B established on purpose.
create index if not exists access_grants_guest_token_hash_idx on access_grants (guest_token_hash);

-- §4.2 — RATE LIMIT for /api/guest/[token]. Token guessing is infeasible at
-- 256 bits; this is about scraping the invalid/expired responses, which are
-- cheap to enumerate and reveal whether a given token ever existed. Same
-- table-counted-per-window pattern as support_rate_limit (0036) and
-- investor_access_request_rate_limit — deliberately NOT a new mechanism,
-- per this prompt's own instruction to check before adding one.
create table if not exists guest_link_rate_limit (
  id uuid primary key default uuid_generate_v4(),
  ip text not null,
  created_at timestamptz not null default now()
);

alter table guest_link_rate_limit enable row level security;

-- Service role only, like its two siblings: the route that writes it runs
-- with the service key, and nothing else ever reads it.
create policy guest_link_rate_limit_platform_admin on guest_link_rate_limit for all
  using (is_platform_admin()) with check (is_platform_admin());

create index if not exists guest_link_rate_limit_ip_created_idx on guest_link_rate_limit (ip, created_at);
