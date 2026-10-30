-- Prompt 922 (Adenda 1, C, 30/10/2026) — how the load of the evaluation is shared: Equal, Weighted (a percentage or a maximum per evaluator) or By rules (panels of evaluators and rules over the answers). Additive only.
-- NOT YET APPLIED (dry run first, then apply — BEFORE the code that reads it is deployed; the "APPLIED" line is stamped afterwards).
--
--   call_eval_distribution_configs   the configuration per call and per VERSION: it is edited in place until the first evaluation is submitted; from then on a change inserts the next version (the rows of earlier
--                                    versions stay). `rev` is the optimistic-concurrency token of the row. Read by our routes with the service role only: same trust boundary as every other calls table. A call with no
--                                    row distributes equally, as it always did.

create table if not exists public.call_eval_distribution_configs (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid        not null references public.calls(id) on delete cascade,
  version     integer     not null check (version >= 1),
  rev         integer     not null default 0 check (rev >= 0),
  config      jsonb       not null check (jsonb_typeof(config) = 'object'),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (call_id, version)
);
alter table public.call_eval_distribution_configs enable row level security;
create index if not exists call_eval_distribution_configs_call_idx on public.call_eval_distribution_configs (call_id, version desc);
revoke all on public.call_eval_distribution_configs from public, anon, authenticated;
