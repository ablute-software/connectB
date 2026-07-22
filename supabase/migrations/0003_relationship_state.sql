-- IRM_SPEC §4e — relationship roadmap: per-org stage overlay + a milestone
-- channel value so stage transitions render on the interaction timeline.
-- Deliberately separate from entities.status (which keeps driving the
-- existing pipeline/automations/rules.ts logic untouched) — this is a
-- founder-facing roadmap concept, not a re-plumbing of the pipeline stage.

alter type channel add value if not exists 'stage_change';

create type relationship_stage as enum ('not_contacted','contacted','engaged','meeting','diligence','decision');

create table relationship_state (
  org_id uuid not null references orgs(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  stage relationship_stage not null default 'not_contacted',
  next_step_task_id uuid references tasks(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, entity_id)
);

alter table relationship_state enable row level security;
create policy relationship_state_all on relationship_state for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create trigger relationship_state_touch before update on relationship_state
  for each row execute function touch_updated_at();

create index on relationship_state (org_id, stage);
