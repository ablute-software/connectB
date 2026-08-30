-- Prompt 480 — the org-level lock the 465 §F.3 gap left open, and which
-- reconciliation.test.ts's own F.3 test asserts the ABSENCE of today ("two
-- overlapping runs BOTH call the model and BOTH pay — a known, accepted,
-- double-cost-only gap"). That test is updated by this prompt, deliberately
-- rather than left to start failing on its own.
--
-- Why a TABLE and not pg_advisory_lock: advisory locks live on the database
-- SESSION, and this code runs behind Supabase's connection pooler. A
-- connection handed back to the pool while still holding an advisory lock
-- is exactly the class of treacherous bug this prompt exists to prevent —
-- it would be introducing one to fix another. A row keyed by org_id is the
-- pooler-safe mechanism: its lifetime is the row's, not the connection's.
--
-- Acquisition is `insert ... on conflict (org_id) do nothing returning
-- org_id` — atomic by the primary key, so two simultaneous callers cannot
-- both win. locked_at is what makes the lock self-healing: a holder that
-- crashed or froze without releasing leaves a row that a later caller
-- treats as stale (>90s, comfortably past the slowest route's
-- maxDuration=60) and takes over, so the lock can never wedge an org
-- permanently waiting for someone to clean up by hand.
--
-- STRICTLY ADDITIVE (AUTONOMOUS_EXECUTION_MODE_v2 §12): one new table, no
-- existing table touched, no backfill, no data change.
-- Rollback: `drop table reconciliation_locks;` — nothing references it and
-- the application reads it behind a capability probe that fails OPEN (with
-- the table absent, reconciliation runs exactly as it does today, unlocked;
-- see reconciliation-lock.ts for why open rather than closed here).
create table if not exists reconciliation_locks (
  org_id uuid primary key references orgs(id) on delete cascade,
  locked_at timestamptz not null default now()
);

-- RLS on, and deliberately NO policy: this table is infrastructure, never
-- founder-facing data. Only the service-role client (which bypasses RLS by
-- role) ever touches it, so the absence of a policy is the fail-closed
-- choice — no `authenticated` or `anon` reader can see or clear another
-- org's lock, and nothing in the app has a reason to.
alter table reconciliation_locks enable row level security;

comment on table reconciliation_locks is
  'Prompt 480 — one row per org while a reconciliation run is in flight. Table-based rather than pg_advisory_lock because this runs behind a connection pooler. locked_at older than 90s means the holder died: a later caller takes the lock over.';
