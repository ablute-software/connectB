-- Prompt 359 Block A — the roadmap CANVAS's data model. Evolves the
-- existing model (company_roadmap_milestones from 0161, roadmap_categories
-- from 0177), never a parallel one: category_id below is the SAME
-- roadmap_categories FK RoadmapItemV2 already used.
--
-- Why a new table rather than adding columns to company_roadmap_milestones:
-- that table's unit is a PERIOD (quarter/year), holding an array of items
-- with no per-item row identity (items_v2 jsonb, documented in 0177's own
-- comment as a deliberate choice — "nothing else references a single
-- item"). A canvas needs the opposite: click/drag/evidence-linking all
-- require a single event to HAVE an id. roadmap_events is that per-event
-- table; company_roadmap_milestones is left in place (nothing reads it
-- after this migration, but nothing is dropped either — DB history stays
-- honest about what actually changed).
create table if not exists roadmap_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  date date not null,
  date_precision text not null default 'exact' check (date_precision in ('exact', 'approx', 'quarter')),
  end_date date,
  status text not null default 'planned' check (status in ('done', 'planned')),
  category_id uuid references roadmap_categories(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  badge_id uuid references company_badges(id) on delete set null,
  media_id uuid references company_media(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roadmap_events_end_after_start check (end_date is null or end_date >= date)
);

create index if not exists roadmap_events_org_idx on roadmap_events(org_id, date);
create index if not exists roadmap_events_category_idx on roadmap_events(category_id);

alter table roadmap_events enable row level security;

drop policy if exists roadmap_events_org_members on roadmap_events;
create policy roadmap_events_org_members on roadmap_events
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table roadmap_events is
  'Prompt 359 — the roadmap canvas unit: one real, datable, draggable event. Evolves company_roadmap_milestones (0161)/roadmap_categories (0177), never a parallel model.';

-- Data migration: every existing milestone item becomes one event, losing
-- nothing. A quarter/year has no specific day, so the date is approximated
-- to the period's FIRST day (never the last — a founder reading "Q1 2026"
-- thinks "start of Q1", and 'approx'/'quarter' precision is what tells the
-- canvas/UI not to over-claim exactness) and date_precision records which
-- kind of approximation it was. status is derived exactly the way
-- periodHasPassed (roadmap.ts) already computes it: the period's END has
-- passed 'now' (this migration's apply time) -> done, else planned — the
-- one-time equivalent of what the app itself would have shown as
-- solid-vs-dashed before this migration.
insert into roadmap_events (org_id, title, date, date_precision, status, category_id, created_at, updated_at)
select
  m.org_id,
  coalesce(item->>'text', '(untitled)'),
  case when m.period_kind = 'year'
    then make_date(m.period_year, 1, 1)
    else make_date(m.period_year, (m.period_quarter - 1) * 3 + 1, 1)
  end as event_date,
  case when m.period_kind = 'year' then 'approx' else 'quarter' end as date_precision,
  case when (
    case when m.period_kind = 'year'
      then make_date(m.period_year, 12, 31)
      else (make_date(m.period_year, m.period_quarter * 3, 1) + interval '1 month' - interval '1 day')::date
    end
  ) < current_date then 'done' else 'planned' end as status,
  nullif(item->>'category_id', '')::uuid,
  m.created_at,
  m.updated_at
from company_roadmap_milestones m
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(m.items_v2) = 'array' and jsonb_array_length(m.items_v2) > 0
    then m.items_v2
    else (select jsonb_agg(jsonb_build_object('text', t, 'category_id', null)) from unnest(m.items) as t)
  end
) as item
where item->>'text' is not null and trim(item->>'text') <> ''
  -- Idempotent against a migration replay: never double-insert the same
  -- (org, title, date) triple.
  and not exists (
    select 1 from roadmap_events re
    where re.org_id = m.org_id and re.title = coalesce(item->>'text', '(untitled)')
      and re.date = (case when m.period_kind = 'year'
        then make_date(m.period_year, 1, 1)
        else make_date(m.period_year, (m.period_quarter - 1) * 3 + 1, 1)
      end)
  );
