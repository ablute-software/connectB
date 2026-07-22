-- IRM_SPEC §6b-3/§6b-4 — AI-assisted research proposals + provenance.
-- Contributions can now come from the AI research route (source='ai'),
-- carrying a confidence score and the source URL it was found at — same
-- verify-then-promote flow as founder-authored contributions (§1b),
-- nothing auto-publishes.

create type contribution_source as enum ('user', 'ai');

alter table contributions add column if not exists source contribution_source not null default 'user';
alter table contributions add column if not exists confidence numeric check (confidence is null or (confidence between 0 and 1));
alter table contributions add column if not exists source_url text;

create index on contributions (source);
