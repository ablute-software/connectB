-- PROPOSTA — NÃO APLICAR SEM OK DO NUNO.
--
-- Prompt 727 §6 — minimal product-usage instrumentation for the "Next step"
-- dossier work: dossier_opened, next_step_seen, message_copied,
-- log_prefilled, interaction_logged. Confirmed by grep before writing this:
-- no product_events/activity_events/usage_heartbeat table exists anywhere
-- in supabase/migrations/ today, and reusing `interactions` with
-- channel='system' doesn't fit (interactions are founder-authored outreach
-- records, not product telemetry, and channel is a real enum this would
-- pollute). This is the smallest table that fills the gap.
--
-- org_id/user_id are who did it; event is a free-ish text column (checked
-- against a fixed list at the API layer, not a DB enum, so adding a new
-- event name later never needs a migration); entity_id is optional context
-- for entity-scoped events. No historical backfill — this only ever
-- records events from the moment it's applied forward.
create table if not exists public.product_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event text not null,
  entity_id uuid references public.entities(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists product_events_org_idx on public.product_events (org_id, created_at desc);
create index if not exists product_events_event_idx on public.product_events (event);

alter table public.product_events enable row level security;

-- Same shape as ai_call_log (0202): platform-internal, admin-only both
-- ways. The one real write path (src/app/api/product-events/route.ts) uses
-- a service-role client, which bypasses RLS entirely — this policy only
-- matters if anon/authenticated ever attempted a direct write, which no
-- app code does.
create policy product_events_admin_only on public.product_events
  for all using (is_platform_admin()) with check (is_platform_admin());
