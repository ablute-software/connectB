-- Prompt 277 A.3 — founder-facing fraud/scam report queue, reviewed by
-- platform admins. Kept as its own table rather than extending
-- suspicious_account_flags/ModerationTargetType ('org' | 'investor') —
-- confirmed by reading that mechanism first, not assumed:
--
-- 1) The actor model is the wrong shape, not just a missing enum value.
--    suspicious_account_flags is admin-write-only at every layer (RLS
--    policy checks is_ablute_developer(), the only route is
--    requirePlatformAdmin()-gated) — deliberately, per that migration's
--    own comment. A founder reporting an entity they're investigating is
--    exactly the write path that table was built to exclude.
-- 2) The report is about the founder's own `entities` row (where
--    hard_filter_status/HardFilterBanner already live), not directly
--    about `catalog_entities` — a reported entity may never have reached
--    the shared catalog at all (a founder can add a purely fake investor
--    manually). entity_id is therefore the real FK target; catalog_id is
--    an optional cross-reference for the admin queue, populated only when
--    this entity happens to be catalog-linked (via entities.source_entity
--    -style delivery), never required.
-- 3) The three existing suspicious-flag actions (alert_email / suspend /
--    delete_and_block) assume a real platform account with a login and an
--    email to block — they don't fit "investigate and decide whether this
--    directory listing is fraudulent." Two review outcomes instead:
--    confirm (agree — flag stays actioned, hard_filter_status stays
--    'resolved_blocked'; when catalog-linked, the admin can additionally
--    call the SAME applyModerationAction() state machine every other
--    suspend/delete in this codebase uses — never a second, parallel one)
--    or dismiss (disagree — flag actioned, the founder's entity is
--    released back to 'open', same as Unblock).
--
-- No new audit columns needed on entities: hard_filter_resolved_at/by
-- (migration 0194) already cover "when/who marked this reported" at the
-- entities-row level; the justification + evidence text belongs on the
-- flag itself, not duplicated as free text on entities.
create table entity_fraud_flags (
  id uuid primary key default uuid_generate_v4(),
  entity_id uuid not null references entities(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  catalog_id uuid references catalog_entities(id) on delete set null,
  justification text not null,
  evidence text not null,
  flagged_by uuid not null references auth.users(id),
  flagged_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'actioned')),
  outcome text check (outcome in ('confirmed', 'dismissed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewer_notes text
);
create index on entity_fraud_flags (org_id, entity_id);
create index on entity_fraud_flags (status, flagged_at desc);

alter table entity_fraud_flags enable row level security;

-- Founders can report and read their own org's flags (so a future "why is
-- this Reported" detail view has something to read — the Pipeline pill
-- itself only ever needs entities.hard_filter_status, already RLS-scoped).
create policy entity_fraud_flags_founder_insert on entity_fraud_flags
  for insert with check (is_org_member(org_id));
create policy entity_fraud_flags_founder_select on entity_fraud_flags
  for select using (is_org_member(org_id));

-- Platform admins review and resolve — same is_platform_admin() gate as
-- every other backoffice-only table in this schema.
create policy entity_fraud_flags_admin_all on entity_fraud_flags
  for all using (is_platform_admin()) with check (is_platform_admin());
