-- Prompt 293 §1 — central ledger for every AI call the platform makes.
-- Confirmed by direct reading: enrichment_jobs (0146) was the ONLY real
-- cost record that existed before this — every other AI-calling route
-- (ai-review, compose, form-assist, coaching, community-consensus,
-- nda-upload, entity enrich/form-questions, import extract, needs-review
-- classify, reawakening evaluate/neglect/rejection-filter, investability,
-- backoffice research) called Anthropic with zero cost tracking at all.
-- This table is the single destination every one of those routes now
-- writes to via src/lib/ai-cost-log.ts's logAiCall() — enrichment_jobs
-- keeps writing its own row as before (the enrichment-worker's own
-- per-job telemetry, used by its cost caps), and additionally mirrors
-- each completed job here too, so this table alone is a complete picture
-- for the backoffice "AI Costs" tab, never a partial one.
--
-- org_id is nullable ON PURPOSE: a shared-catalog call (enrichment-worker,
-- backoffice research reaching across orgs) benefits every org that has
-- or will have that catalog entity, not the one org that happened to
-- trigger it — attributing it to a single org would misrepresent per-org
-- spend. Null org_id rows are reported as their own "shared catalog" line
-- in the costs UI, never split arbitrarily across orgs.
create table public.ai_call_log (
  id uuid primary key default uuid_generate_v4(),
  route text not null,
  purpose text not null,
  model text not null,
  tokens_in int,
  tokens_out int,
  cost_eur numeric(10, 5) not null default 0,
  org_id uuid references public.orgs(id) on delete set null,
  target_type text,
  target_id uuid,
  created_at timestamptz not null default now()
);

create index ai_call_log_org_idx on public.ai_call_log (org_id);
create index ai_call_log_route_idx on public.ai_call_log (route);
create index ai_call_log_created_at_idx on public.ai_call_log (created_at desc);

alter table public.ai_call_log enable row level security;

-- Platform-internal operational data — no founder-facing read at all
-- (the prompt only ever asks for a backoffice tab), admin-only both ways.
-- Actual writes go through logAiCall()'s service-role client, which
-- bypasses RLS entirely — this policy only matters if anon/authenticated
-- ever tried a direct write, which no app code does.
create policy ai_call_log_admin_only on public.ai_call_log
  for all using (is_platform_admin()) with check (is_platform_admin());
