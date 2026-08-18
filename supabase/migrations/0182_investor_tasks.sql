-- Prompt 247 B / 248 — investor's own task/reminder calendar (mirrors the
-- founder-side Agenda: month grid, Overdue/Due today/This week/Completed
-- rail, create-task modal with reminder). Needs its own table, not the
-- founder's `tasks` (0001_init.sql): that table's RLS is
-- is_org_member(org_id), which an investor can never satisfy for a
-- startup's org — reusing it would mean either breaking that boundary or
-- mixing two different trust models into one table's policy set (exactly
-- the risk flagged and avoided in the 248 review of this migration).
--
-- Trust boundary instead mirrors investor_followups (migration 0060): RLS
-- enabled, ZERO policies for any authenticated role — service-role
-- /api/portal/tasks routes are the only way in or out, ownership by
-- investor_email. Never touches org_members/is_org_member.
--
-- org_id is nullable — the investor's optional "which startup is this
-- about", equivalent to the founder's tasks.entity_id. kind/action_type
-- reuse the SAME Postgres enums as the founder's tasks table (task_kind,
-- task_action_type — 0001_init.sql/0019_task_action_type.sql) so the
-- mirrored UI can reuse ACTION_TYPE_LABEL/ACTION_TYPE_COLOR/ACTION_TYPES
-- as-is, per the approved 247 B proposal. notes/reminder_at/snoozed_until
-- mirror tasks' own migration 0123.
create table investor_tasks (
  id uuid primary key default gen_random_uuid(),
  investor_email text not null,
  org_id uuid references orgs(id) on delete set null,
  title text not null,
  kind task_kind not null default 'meeting',
  action_type task_action_type not null default 'other',
  due_at timestamptz,
  notes text,
  reminder_at timestamptz,
  snoozed_until timestamptz,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table investor_tasks enable row level security;
create index on investor_tasks (investor_email, due_at);
create index on investor_tasks (investor_email, reminder_at);
