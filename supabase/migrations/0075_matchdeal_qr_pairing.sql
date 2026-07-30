-- MatchDeal QR pairing spec — reverses the direction of the CURRENT
-- pairing flow (matchdeal_device_links: phone shows a code, web enters
-- it, founder-only) to web-shows-QR / phone-scans, for both founder and
-- investor sessions. Deliberately a NEW table pair, not a repurposing of
-- matchdeal_device_links — that table's shape (session_email/otp minting)
-- is specific to the old "hand the phone a fresh app session" mechanic,
-- which this flow doesn't need (the app already has its own session; it
-- just needs to prove which org the token belongs to).
--
-- Tokens are stored HASHED (sha256 hex, computed the same way in the
-- Next.js route — Node crypto — and the Edge Function — Web Crypto
-- subtle.digest — so both sides agree). The raw token is returned to the
-- caller exactly once, at generation, and never persisted anywhere.
create table if not exists matchdeal_pairing_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  org_id uuid not null,
  kind text not null check (kind in ('startup', 'investor')),
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_device text,
  status text not null default 'active' check (status in ('active', 'used', 'expired', 'revoked'))
);
create index if not exists matchdeal_pairing_tokens_user_idx on matchdeal_pairing_tokens (user_id, created_at desc);
create index if not exists matchdeal_pairing_tokens_org_idx on matchdeal_pairing_tokens (org_id, kind, status);

create table if not exists matchdeal_pairings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  kind text not null check (kind in ('startup', 'investor')),
  user_id uuid not null references auth.users(id),
  device_id text not null,
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'disconnected')),
  disconnected_at timestamptz
);
create index if not exists matchdeal_pairings_org_idx on matchdeal_pairings (org_id, kind, status);

-- Section 8 — failed consume attempts logged for audit (wrong account,
-- expired, already used, unknown token). No raw token, no personal data —
-- only the hash and the outcome category.
create table if not exists matchdeal_pairing_audit (
  id uuid primary key default gen_random_uuid(),
  token_hash text,
  token_org_id uuid,
  attempted_by_user_id uuid,
  attempted_org_id uuid,
  result text not null check (result in ('completed', 'expired', 'wrong_account', 'already_used', 'unknown_token', 'other')),
  created_at timestamptz not null default now()
);
create index if not exists matchdeal_pairing_audit_time_idx on matchdeal_pairing_audit (created_at desc);

alter table matchdeal_pairing_tokens enable row level security;
create policy matchdeal_pairing_tokens_own on matchdeal_pairing_tokens for select
  using (user_id = auth.uid());

alter table matchdeal_pairings enable row level security;
create policy matchdeal_pairings_own_org on matchdeal_pairings for select
  using (org_id in (select public.matchdeal_current_membership_ids()) or org_id in (select org_id from org_members where user_id = auth.uid()));

alter table matchdeal_pairing_audit enable row level security;
create policy matchdeal_pairing_audit_admin on matchdeal_pairing_audit for all
  using (is_platform_admin()) with check (is_platform_admin());
