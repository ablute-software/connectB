-- ablute_ Investor CRM — initial schema (multi-tenant)
-- Applies cleanly to a fresh Supabase project.

create extension if not exists "uuid-ossp";

-- ===== enums =====
create type entity_type as enum ('vc','corporate_vc','family_office','angel_fund','angel_network','public_body','accelerator');
create type stage as enum ('pre_seed','seed','series_a','later');
create type fit_score as enum ('high','medium_high','medium','low');
create type hard_filter_status as enum ('open','resolved_ok','resolved_blocked','not_applicable');
create type entity_status as enum ('not_contacted','contacted','in_conversation','diligence','passed','invested','dormant');
create type hook_status as enum ('researched','to_research','none_found');
create type email_confidence as enum ('high','medium','low');
create type direction as enum ('out','in');
create type channel as enum ('linkedin_dm','linkedin_note','email','web_form','call','meeting','event','intro');
create type classification as enum ('awaiting','interested','meeting_request','question','pass','out_of_office','bounce','unclear');
create type pass_reason_category as enum ('valuation','check_size','geography','stage_too_early','thesis_mismatch','team','traction','other');
create type task_kind as enum ('follow_up','meeting','research','admin');
create type override_rule as enum ('contact_lock','seniority_order','hard_filter','daily_cap','weekly_cap','follow_up_limit');
create type submission_channel_type as enum ('email','form','none','unknown');
create type org_role as enum ('owner','member');
create type folder_kind as enum ('data_room','materials');
create type doc_visibility as enum ('private','on_grant','link_anyone');
create type automation_mode as enum ('draft_review','full_auto');
create type automation_trigger as enum ('no_reply_14d','followup_no_reply_14d','inbound_meeting_request','inbound_pass','contact_lock_expired','grant_activated','document_viewed','hook_missing');
create type automation_action as enum ('draft_follow_up','create_task','propose_dormant','notify_owner','send_grant_email','draft_reply');
create type run_status as enum ('drafted','pending_review','approved','executed','rejected','blocked_preflight','failed');
create type plan_tier as enum ('free','paid');
create type ai_review_kind as enum ('deck_review','one_pager_review','message_review','market_data');
create type preferred_language as enum ('en','pt');

-- ===== tenancy =====
create table orgs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  plan plan_tier not null default 'free',
  daily_cap int not null default 5,
  weekly_cap int not null default 20,
  sender_email text,
  bcc_email text,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role org_role not null default 'member',
  primary key (org_id, user_id)
);

-- ===== CRM core =====
create table entities (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  type entity_type not null,
  hq_city text, hq_country text,
  invests_in_geographies text[] default '{}',
  website text, website_verified boolean not null default false,
  email_domain text, email_domain_verified boolean not null default false,
  stage_min stage, stage_max stage,
  check_min_eur int, check_max_eur int,
  sectors text[] default '{}',
  thesis text,
  fit_score fit_score,
  wave int,
  our_angle text,
  the_ask text,
  submission_channel text,
  submission_channel_type submission_channel_type not null default 'unknown',
  hard_filter text,
  hard_filter_status hard_filter_status not null default 'not_applicable',
  network_cluster_notes text,
  interest_eur int,
  contact_lock_until timestamptz,
  status entity_status not null default 'not_contacted',
  dormant_since timestamptz, dormant_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table people (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  full_name text not null,
  role text,
  seniority_rank int not null default 1,
  based_in text,
  linkedin_url text, linkedin_verified boolean not null default false,
  email_verified text,
  email_guess text,
  email_guess_confidence email_confidence,
  email_source text,
  bounce_count int not null default 0,
  phone text,
  background text,
  personal_notes text,
  linked_companies text[] default '{}',
  linked_funds text[] default '{}',
  hook text,
  hook_status hook_status not null default 'to_research',
  kill_words text[] default '{}',
  watch_outs text,
  preferred_language preferred_language not null default 'en',
  intro_path text,
  referred_by uuid references people(id),
  data_source text,
  privacy_notice_sent boolean not null default false,
  do_not_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== documents & data room (declared before interactions for FK) =====
create table folders (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  parent_id uuid references folders(id) on delete cascade,
  kind folder_kind not null,
  position int not null default 0
);

create table documents (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  name text not null,
  version text,
  storage_path text,
  external_url text,
  is_view_only boolean not null default false,
  visibility doc_visibility not null default 'private',
  watermark boolean not null default false,
  downloadable boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  constraint no_edit_links check (external_url is null or position('/edit' in external_url) = 0)
);

create table access_grants (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  person_id uuid references people(id) on delete cascade,
  grantee_email text,
  folder_id uuid references folders(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  nda_required boolean not null default false,
  nda_accepted_at timestamptz,
  note text,
  constraint grant_has_grantee check (person_id is not null or grantee_email is not null),
  constraint grant_has_scope check (folder_id is not null or document_id is not null)
);

create table document_views (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  grant_id uuid references access_grants(id) on delete set null,
  viewer_email text,
  viewed_at timestamptz not null default now(),
  seconds int,
  pages int
);

-- ===== interactions & tasks =====
create table interactions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  person_id uuid references people(id) on delete set null,
  occurred_at timestamptz not null default now(),
  direction direction not null,
  channel channel not null,
  sent_from text,
  content text not null,
  document_id uuid references documents(id) on delete set null,
  classification classification,
  pass_reason_category pass_reason_category,
  pass_reason text,
  next_action text,
  next_action_due date,
  automation_run_id uuid,
  created_at timestamptz not null default now(),
  constraint pass_requires_reason check (classification is distinct from 'pass' or pass_reason is not null)
);

create table tasks (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null,
  due_at timestamptz,
  entity_id uuid references entities(id) on delete cascade,
  person_id uuid references people(id) on delete cascade,
  kind task_kind not null default 'admin',
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table rule_overrides (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  rule override_rule not null,
  entity_id uuid references entities(id) on delete set null,
  person_id uuid references people(id) on delete set null,
  interaction_id uuid references interactions(id) on delete set null,
  justification text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ===== automations =====
create table message_templates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  channel channel not null,
  language preferred_language not null default 'en',
  body text not null
);

create table automations (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  trigger automation_trigger not null,
  action automation_action not null,
  mode automation_mode not null default 'draft_review',
  channel channel,
  template_id uuid references message_templates(id) on delete set null,
  enabled boolean not null default true,
  config jsonb not null default '{}'
);

create table automation_runs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  entity_id uuid references entities(id) on delete set null,
  person_id uuid references people(id) on delete set null,
  status run_status not null default 'drafted',
  payload jsonb not null default '{}',
  blocked_reason text,
  error text,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

alter table interactions
  add constraint interactions_automation_run_fk
  foreign key (automation_run_id) references automation_runs(id) on delete set null;

-- ===== AI reviews (paid) =====
create table ai_reviews (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  interaction_draft text,
  kind ai_review_kind not null,
  status text not null default 'pending',
  result jsonb,
  model text,
  created_at timestamptz not null default now()
);

-- ===== indexes =====
create index on entities (org_id, status);
create index on people (org_id, entity_id);
create index on interactions (org_id, entity_id, occurred_at desc);
create index on tasks (org_id, done, due_at);
create index on access_grants (org_id, person_id);
create index on document_views (org_id, document_id, viewed_at desc);
create index on automation_runs (org_id, status);

-- ===== RLS =====
alter table orgs enable row level security;
alter table org_members enable row level security;
alter table entities enable row level security;
alter table people enable row level security;
alter table folders enable row level security;
alter table documents enable row level security;
alter table access_grants enable row level security;
alter table document_views enable row level security;
alter table interactions enable row level security;
alter table tasks enable row level security;
alter table rule_overrides enable row level security;
alter table message_templates enable row level security;
alter table automations enable row level security;
alter table automation_runs enable row level security;
alter table ai_reviews enable row level security;

create or replace function is_org_member(check_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members m
    where m.org_id = check_org and m.user_id = auth.uid()
  );
$$;

create policy org_select on orgs for select using (is_org_member(id));
create policy org_update on orgs for update using (
  exists (select 1 from org_members m where m.org_id = id and m.user_id = auth.uid() and m.role = 'owner')
);
create policy members_select on org_members for select using (is_org_member(org_id));

-- generic member policies for all org-scoped tables
do $$
declare t text;
begin
  foreach t in array array['entities','people','folders','documents','access_grants','document_views',
                           'interactions','tasks','rule_overrides','message_templates','automations',
                           'automation_runs','ai_reviews']
  loop
    execute format('create policy %I_all on %I for all using (is_org_member(org_id)) with check (is_org_member(org_id));', t, t);
  end loop;
end $$;

-- NOTE: the external investor portal accesses documents through signed URLs +
-- an edge/API route that validates access_grants (magic-link session), never
-- through direct table access — no RLS policy grants investors table reads.

-- updated_at triggers
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger entities_touch before update on entities for each row execute function touch_updated_at();
create trigger people_touch before update on people for each row execute function touch_updated_at();
