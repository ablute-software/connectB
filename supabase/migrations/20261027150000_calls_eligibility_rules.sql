-- Prompt 918 (I2, 27/10/2026) — the Setup step "Eligibility rules" (spec §7). Additive only.
-- APPLIED 27/10/2026 to wkjcaoqdvhykrfacsylr (ledger version 20261027163530, name calls_eligibility_rules) after a dry run (a transaction that was rolled back).
--
--   call_eligibility_rules       the rules of a call, VERSIONED: each rule is tied to a question or a document of the form (field_id) and belongs to one version of the call's rule set. While the call
--                                is being set up the active version is edited in place; once the call opens, a change makes a NEW version (the previous one stays, for the record) and the applications are
--                                evaluated again against it.
--   call_eligibility_recipes     the "recipe" the platform prepares for each document rule (type of document, other names, headings, issuer, fields to read, comparisons) from the text the ENTITY
--                                wrote. Per call, field and version — never shared between calls.
--   call_eligibility_dismissed   suggestions from the import ("Suggested rules") that the entity discarded, so they do not come back.
--   calls.eligibility_version    the version of the rule set in force (1 = the first).
--   calls.eligibility_rev        bumped by every change of the rules: the optimistic-concurrency token of the step (two people editing the rules do not overwrite each other).
--
-- Same trust boundary as the other calls tables: RLS on, no policy for anon, reads for authenticated through membership are not needed here (every access goes through our routes with the service role).

alter table public.calls add column if not exists eligibility_version integer not null default 1 check (eligibility_version >= 1);
alter table public.calls add column if not exists eligibility_rev integer not null default 0 check (eligibility_rev >= 0);

create table if not exists public.call_eligibility_rules (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid        not null references public.calls(id) on delete cascade,
  version     integer     not null default 1 check (version >= 1),
  -- The question or document of the form this rule is about. NOT a foreign key: a form is replaced as a whole while it is edited; a rule whose question went away is shown as broken, not deleted.
  field_id    uuid        not null,
  kind        text        not null check (kind in ('options', 'number', 'date', 'yes_no', 'doc_present', 'doc_right', 'doc_valid', 'doc_authentic', 'open')),
  params      jsonb       not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  note        text,
  position    integer     not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
alter table public.call_eligibility_rules enable row level security;
create index if not exists call_eligibility_rules_call_idx on public.call_eligibility_rules (call_id, version, position);

create table if not exists public.call_eligibility_recipes (
  id            uuid primary key default gen_random_uuid(),
  call_id       uuid        not null references public.calls(id) on delete cascade,
  rule_id       uuid        not null,
  field_id      uuid        not null,
  version       integer     not null default 1,
  -- What was prepared, and the entity's own words it was prepared from (so the page can say "from the text you wrote").
  recipe        jsonb       not null check (jsonb_typeof(recipe) = 'object'),
  source_text   text        not null default '',
  prepared_at   timestamptz not null default now()
);
alter table public.call_eligibility_recipes enable row level security;
create index if not exists call_eligibility_recipes_call_idx on public.call_eligibility_recipes (call_id, version);

create table if not exists public.call_eligibility_dismissed (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid        not null references public.calls(id) on delete cascade,
  text        text        not null check (btrim(text) <> ''),
  dismissed_by uuid,
  created_at  timestamptz not null default now(),
  unique (call_id, text)
);
alter table public.call_eligibility_dismissed enable row level security;

revoke all on public.call_eligibility_rules, public.call_eligibility_recipes, public.call_eligibility_dismissed from public, anon, authenticated;
