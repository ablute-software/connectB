-- P134-C — Sherlock messaging: one continuous thread per (startup, investor
-- firm) pair, the "mix de DM" the mini-prompt asked for (a real inbox, not
-- one-off emails). PROPOSE ONLY — Nuno pre-verifies and applies this
-- himself, same process as every other migration this session.
--
-- Org-level on BOTH sides (AP-14 convention): investor_catalog_entity_id
-- identifies the FIRM, not the individual who happens to be signed in —
-- any teammate at that firm sees the same thread, same as
-- investor_relationship_decisions. sender_user_id still records exactly
-- who typed each message, so "por quem, para quem" (Nuno's own wording)
-- is never lost even though the relationship itself is firm-level.
--
-- RLS enabled, ZERO policies — same pattern as 0125 (investor_interaction_log):
-- every read/write goes through service-role portal/founder routes only,
-- scoped server-side (investor by the session's own catalog_entity_id,
-- founder by is_org_member). Deliberately not the founder-readable pattern
-- investor_relationship_decisions uses — a message thread is a live
-- conversation, not a decision record, and the route itself already has to
-- validate the relationship + document-grant boundary on every write, so a
-- client-facing SELECT policy would just be a second, looser copy of that
-- same check.
create table if not exists deal_threads (
  id uuid primary key default gen_random_uuid(),
  startup_org_id uuid not null references orgs(id) on delete cascade,
  investor_catalog_entity_id uuid not null references catalog_entities(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  investor_last_read_at timestamptz,
  founder_last_read_at timestamptz,
  unique (startup_org_id, investor_catalog_entity_id)
);

create table if not exists deal_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references deal_threads(id) on delete cascade,
  sender_side text not null check (sender_side in ('investor', 'founder')),
  sender_user_id uuid not null references auth.users(id),
  body text not null,
  -- {label,url}[] — same freeform-links convention as 0125's own
  -- investor_interaction_log.links, not uploads.
  links jsonb not null default '[]'::jsonb,
  -- Only ever documents this investor firm already has grant-visibility
  -- to (validated server-side on insert, never trusted from the client) —
  -- messages are never a channel for bypassing the data room.
  document_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists deal_messages_thread_idx on deal_messages (thread_id, created_at);

alter table deal_threads enable row level security;
alter table deal_messages enable row level security;
-- Deliberately no policies at all — service-role only, see header comment.
