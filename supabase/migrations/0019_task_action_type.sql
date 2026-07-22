-- Agenda / Log Interaction — "tipos de compromisso": a finer-grained label
-- than the existing task_kind (follow_up/meeting/research/admin), tied to
-- WHY this task exists from an outreach-discipline standpoint, not just
-- what kind of task it is. Additive — task_kind stays untouched (still
-- used by the existing "avoid a duplicate research task" check and the
-- Agenda month grid's color coding).
create type task_action_type as enum ('first_contact', 'follow_up_no_reply', 'follow_up_thread', 'research_hook', 'other');
alter table tasks add column if not exists action_type task_action_type not null default 'other';
