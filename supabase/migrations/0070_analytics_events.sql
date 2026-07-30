-- SherlockDeal_Metricas_BackOffice_V1, Section 13 — the event model. "Esta
-- secção não sofre qualquer redução... é a fundação sobre a qual tudo o
-- que foi adiado será construído sem retrabalho." One generic table, the
-- 23 fields the spec lists verbatim (13.1). Written from day 1 regardless
-- of whether the V1 dashboard surfaces a given cut yet — presentation is
-- reversible, an unwritten event is not.
--
-- Deliberately does NOT duplicate history that's already historized
-- elsewhere in this schema in a form the funnel/timing metrics can read
-- directly (interactions rows for outreach, relationship_state for the
-- founder's own stage milestones) — those stay the source of truth for
-- their own domain. This table exists for what genuinely has no history
-- today: org lifecycle (registration, activation milestones), plan/MRR
-- transitions, acquisition/promo/referral attribution, and
-- pipeline-relation stage transitions on entities.status (confirmed via
-- code read: setEntityStatus() does a raw UPDATE with no log at all).
--
-- No PII columns exist by construction (name/email/phone/IP/message text/
-- AI draft text/document content/free-text feedback) — Section 3's
-- exclusion list is enforced by simply never having a column for it, not
-- by a runtime check that could be bypassed.
create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  organization_type text not null check (organization_type in ('startup', 'investor')),
  plan_at_event_time text,
  billing_frequency_at_event_time text,
  country_at_event_time text,
  sector_at_event_time text,
  stage_at_event_time text,
  event_type text not null,
  event_timestamp timestamptz not null default now(),
  related_startup_id uuid,
  related_investor_id uuid,
  pipeline_relation_id uuid,
  investor_source text,
  acquisition_source text,
  feature_source text,
  automation_id uuid,
  campaign_or_thread_id uuid,
  result text,
  status text,
  failure_category text,
  source_of_action text check (source_of_action is null or source_of_action in ('manual', 'automatic', 'system_generated')),
  promo_code_id uuid,
  partner_id text,
  data_room_access_level text,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_org_idx on analytics_events (organization_id, organization_type);
create index if not exists analytics_events_type_time_idx on analytics_events (event_type, event_timestamp);
create index if not exists analytics_events_pipeline_relation_idx on analytics_events (pipeline_relation_id) where pipeline_relation_id is not null;
