-- APPLIED on 03/11/2026 to wkjcaoqdvhykrfacsylr (dry run in a rolled-back transaction first), before the code that reads it was deployed.
-- Prompt 925 (03/11/2026) — the selection of a call: rules (minimums, places, budget, quotas, tie-break), each calculation of the PROPOSAL, and where each decision came from. Additive only.
--
--   call_selection_rules   the rules of the call, VERSIONED (a change makes a new version; the current one is `is_current`). `manual_order` is what the people decided for applications the tie-break chain cannot tell
--                          apart (a decision, not a rule: it does not make a new version). In this first version a call has one set of rules for the whole selection (not one per phase).
--   call_selection_runs    every time the proposal was calculated: with which version of the rules, by whom, when, the summary, a fingerprint of the inputs (to say "the proposal is out of date"), and when it was applied.
--   call_selection_items   the proposal of each application in a run: place, outcome, the sentence that explains it, the quotas it counts in, the amount, whether it is a tie / was skipped for the budget.
--   call_eval_decisions    `origin` ('proposal' when "Apply proposal" wrote it, 'manual' when a person did) and the run it came from.
-- Service role only (RLS on, nothing granted), like every other calls table.

create table if not exists public.call_selection_rules (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid        not null references public.calls(id) on delete cascade,
  version     integer     not null check (version >= 1),
  rules       jsonb       not null check (jsonb_typeof(rules) = 'object'),
  manual_order jsonb      not null default '[]'::jsonb check (jsonb_typeof(manual_order) = 'array'),
  is_current  boolean     not null default true,
  created_by  uuid        not null,
  created_at  timestamptz not null default now(),
  unique (call_id, version)
);
create unique index if not exists call_selection_rules_current_uq on public.call_selection_rules (call_id) where is_current;
alter table public.call_selection_rules enable row level security;

create table if not exists public.call_selection_runs (
  id            uuid primary key default gen_random_uuid(),
  call_id       uuid        not null references public.calls(id) on delete cascade,
  rules_version integer     not null,
  created_by    uuid        not null,
  created_at    timestamptz not null default now(),
  summary       jsonb       not null default '{}'::jsonb,
  input_hash    text        not null,
  applied_at    timestamptz,
  applied_by    uuid
);
create index if not exists call_selection_runs_call_idx on public.call_selection_runs (call_id, created_at desc);
alter table public.call_selection_runs enable row level security;

create table if not exists public.call_selection_items (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid        not null references public.call_selection_runs(id) on delete cascade,
  application_id uuid        not null references public.call_applications(id) on delete cascade,
  position       integer,
  outcome        text        not null check (outcome in ('selected', 'waitlist', 'reject', 'not_considered')),
  explanation    text        not null default '',
  quota_ids      jsonb       not null default '[]'::jsonb,
  amount         numeric,
  tie            boolean     not null default false,
  budget_skipped boolean     not null default false,
  unique (run_id, application_id)
);
alter table public.call_selection_items enable row level security;

alter table public.call_eval_decisions add column if not exists origin text not null default 'manual' check (origin in ('proposal', 'manual'));
alter table public.call_eval_decisions add column if not exists proposal_run_id uuid;

revoke all on public.call_selection_rules, public.call_selection_runs, public.call_selection_items from anon, authenticated;
