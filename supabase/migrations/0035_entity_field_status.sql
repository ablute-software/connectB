-- Prompt 28, Task 2 — 'held' (migration 0034) protects a *contribution*
-- pending review; it does nothing for a value that's already written on
-- the entity. If a human spends a night confirming data and the decision
-- only lives on the contribution, the next automatic run can still
-- overwrite the field itself. This is the other half: a status per
-- (entity, field), checked before every other rule, including rule 5.
--
-- UNDER_REVIEW = someone asked for a second look, nobody decided yet.
-- BLOCKED = a human looked and is deliberately freezing the field.
-- Different things (same distinction as HUMAN_REVIEW vs HELD with the
-- external engine) — both must be equally immune, or whichever one isn't
-- gets caught by the first rule that runs.
create table entity_field_status (
  id uuid primary key default uuid_generate_v4(),
  entity_id uuid not null references entities(id) on delete cascade,
  field text not null,
  status text not null check (status in ('OK', 'UNDER_REVIEW', 'BLOCKED')),
  reason text,
  set_by text not null, -- 'human' | 'rule:<name>' | 'import:<engine>'
  set_at timestamptz not null default now(),
  released_at timestamptz -- null while active
);

-- Only one ACTIVE row per (entity, field) — released_at is how a status
-- ends (an explicit human action fills it), never an update-in-place, so
-- history isn't lost.
create unique index entity_field_status_active_unique on entity_field_status (entity_id, field) where released_at is null;

create index entity_field_status_entity_idx on entity_field_status (entity_id);
