-- P133 (item 10) — investor-side interaction log. The mirror, on the
-- investor's side, of the founder's own CRM `interactions` table: manual
-- notes plus links, rendered alongside automatic entries (decisions,
-- archive/reopen, a MatchDeal conversation link-out) into one timeline per
-- startup. PROPOSE ONLY — Nuno pre-verifies and applies this himself, same
-- process as every other migration this session.
--
-- Org-level per investor firm: investor_catalog_entity_id (AP-14 — the same
-- stable identity investor_relationship_decisions already uses), never
-- per-user, so a colleague at the same firm sees the same log.
--
-- Privacy is the entire point of this table: the founder must NEVER see it —
-- these are the investor's own private notes, the exact mirror of how the
-- founder's own CRM `interactions` stays invisible to the investor. RLS is
-- enabled with ZERO policies (default-deny for both anon and authenticated
-- roles) — every read/write goes through service-role portal routes only,
-- scoped server-side to the session's own investor_catalog_entity_id.
-- investor_archive_entries/startup_profile_snapshots (0061) rely on "no
-- client code ever queries this table" alone (RLS never even enabled on
-- them); this table holds more sensitive freeform notes, so RLS is enabled
-- explicitly as a second layer even though no policy ever grants a row.
create table if not exists investor_interaction_log (
  id uuid primary key default gen_random_uuid(),
  investor_catalog_entity_id uuid not null references catalog_entities(id) on delete cascade,
  startup_org_id uuid not null references orgs(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  channel text not null check (channel in ('matchdeal', 'email', 'call', 'meeting', 'message', 'other')),
  content text not null,
  -- v1 of "documents exchanged" is links, not uploads (real file storage is
  -- a separate decision — see the mini-prompt's own scope note). Array of
  -- {label, url}, validated as an array server-side before insert.
  links jsonb not null default '[]'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists investor_interaction_log_firm_startup_idx
  on investor_interaction_log (investor_catalog_entity_id, startup_org_id, occurred_at desc);

alter table investor_interaction_log enable row level security;
-- Deliberately no policies at all — service-role only, see header comment.
