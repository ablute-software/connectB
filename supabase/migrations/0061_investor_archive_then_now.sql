-- Investor Workspace Archive/History (prompt 60) — three new tables.
--
-- 1. startup_profile_snapshots — STRUCTURED (not AI-generated text) capture
--    of an org's key fields at a moment, so the "then vs now" diff is
--    auditable data, not just a paragraph the model wrote once. Reused for
--    both the "First contact"/"Last contact" columns and as the AI's own
--    grounding input for "Now".
create table startup_profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  reason text not null check (reason = any (array['first_contact','archived','manual','regenerated'])),
  data jsonb not null,
  captured_at timestamptz not null default now()
);
create index on startup_profile_snapshots (org_id, captured_at desc);

-- 2. investor_archive_entries — the archive record. One row per archive
-- EVENT, not per (org, investor) pair — reopening then re-archiving later
-- creates a second row, so the full cycle history survives (prompt's own
-- "histórico contínuo" requirement). first_contact_snapshot_id is the
-- earliest snapshot on record for this (org, investor) pair at the time of
-- archiving (itself, if this is the first archive ever) — archived_snapshot_id
-- is this event's own "Last contact" state.
create table investor_archive_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  investor_email text not null,
  source text not null check (source = any (array['pass','round_closed','manual'])),
  reason_detail text,
  first_contact_snapshot_id uuid not null references startup_profile_snapshots(id),
  archived_snapshot_id uuid not null references startup_profile_snapshots(id),
  archived_at timestamptz not null default now(),
  reopened_at timestamptz
);
create index on investor_archive_entries (investor_email, org_id);
-- Only one ACTIVE (not reopened) archive entry per investor per startup —
-- mirrors matchdeal's own "one open match per pair" partial-unique pattern.
create unique index investor_archive_one_active_per_pair on investor_archive_entries (org_id, investor_email)
  where (reopened_at is null);

-- 3. startup_now_summaries — ONE row per org, not per investor. "Now" is the
-- startup's current state — identical for every investor who archived it —
-- so caching it per-org rather than per-archive-entry means an org with,
-- say, 5 investors who all passed only ever costs ONE AI call to keep
-- fresh, not 5. Regenerated on founder-initiated round/profile updates
-- (trigger, not periodic — see /api/org/update's own comment for why: same
-- "no cron, fact-triggered only" discipline the reawakening engine already
-- uses in this codebase), and only when >=1 archive entry exists for the
-- org, so an org nobody has archived never costs a call at all.
--
-- Cost estimate (Claude Sonnet, ~2026 pricing): one call per founder save
-- of round/profile fields, ~400 input tokens + ~150 output tokens, on the
-- order of $0.001-0.002/call. A founder edits round terms a handful of
-- times a month at most — this is negligible, well under $1/org/year even
-- pessimistically.
create table startup_now_summaries (
  org_id uuid primary key references orgs(id) on delete cascade,
  summary_text text not null,
  based_on_snapshot_id uuid not null references startup_profile_snapshots(id),
  generated_at timestamptz not null default now()
);

-- History-vs-access distinction (prompt's own question): CONFIRMED already
-- correct, nothing new needed. access_grants.revoked_at is a soft flag
-- (store-supabase.tsx's revokeGrant does an UPDATE, never a DELETE), so
-- nda_accepted_at survives revocation permanently on that same row —
-- consent history is already perpetual while grantIsActive()/
-- unlockedGrants() already correctly deny live content access once
-- revoked_at is set. document_views rows are likewise never deleted on
-- revoke. Nothing in today's schema blocks the "keep the record, not the
-- access" requirement.
