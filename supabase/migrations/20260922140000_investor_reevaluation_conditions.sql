-- Prompt 716 (Fase 2 do "pipeline que aprende") — PROPOSED, NOT applied to
-- production. Builds directly on Prompt 715's schema (investor_opportunity_
-- episodes, investor_signal_events) — this branch is based on that one's
-- branch, not on main, so the FK below references a real table rather than
-- a guess. Numbered after 715's own 20260922130000, checked against the
-- ledger and every remote branch's migrations directory.
--
-- "What would need to change for you to look again?" — a condition
-- attached to a pass, with a deterministic, template-only reapresentation
-- when the startup declares the matching fact. Shares 715's episode/event/
-- mandate-version substrate (Pedido A/B/D), per this prompt's own explicit
-- dependency note.

create table if not exists investor_reevaluation_conditions (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references investor_opportunity_episodes(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  investor_catalog_entity_id uuid not null references catalog_entities(id) on delete cascade,
  -- The chip that led here (Prompt 715's own vocabulary — too_early,
  -- traction, team_execution, valuation) — kept for context, never shown
  -- to the founder.
  obstacle text not null,
  condition_kind text not null check (condition_kind in (
    'first_customer', 'pilot_completed', 'recurring_revenue', 'technical_validation',
    'regulatory_milestone', 'team_complete', 'lead_investor_confirmed', 'new_round_condition',
    'date', 'never_show_again'
  )),
  -- Free-form detail: an optional revenue figure, a missing role name, or
  -- the target date for a 'date' condition (also mirrored onto
  -- investor_followups.remind_at when that's the mechanism used).
  condition_value text,
  origin text not null default 'declared' check (origin in ('declared', 'inferred')),
  -- Set only for a kind that needs founder consent (everything except
  -- 'date', which is the investor's own reminder, and 'never_show_again',
  -- which needs nothing at all). NULL means "no consent flow attached".
  watch_id uuid references investor_watches(id) on delete set null,
  -- Set only for 'date' — investor_followups is the reminder mechanism per
  -- this prompt's own explicit instruction ("reutilizar investor_followups"),
  -- never a second reminder system.
  followup_id uuid references investor_followups(id) on delete set null,
  decided_at timestamptz not null default now(),
  decided_by uuid not null references auth.users(id),
  review_by date,
  last_represented_at timestamptz,
  times_represented integer not null default 0,
  -- "não voltar a mostrar" — a definitive pass on this specific startup,
  -- for this specific firm. Checked before ANY future alert/reapresentation
  -- for this org, regardless of which condition or new marker fires.
  definitive_pass boolean not null default false,
  fulfilled_at timestamptz,
  fulfilled_fact_text text,
  is_test_or_internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists investor_reevaluation_conditions_episode_idx on investor_reevaluation_conditions (episode_id);
create index if not exists investor_reevaluation_conditions_org_investor_idx on investor_reevaluation_conditions (investor_catalog_entity_id, org_id);
create index if not exists investor_reevaluation_conditions_watch_idx on investor_reevaluation_conditions (watch_id) where watch_id is not null;
-- "o mesmo marco declarado duas vezes não reabre" — enforced structurally:
-- once a condition is fulfilled it stays fulfilled (fulfilled_at is only
-- ever set once, checked in application code before writing an alert), and
-- a firm can hold at most one OPEN (unfulfilled, non-definitive) condition
-- of the same kind per org — a second identical unfulfilled condition
-- would just be re-asking the same question, not tracking a new obstacle.
create unique index if not exists investor_reevaluation_conditions_open_kind_idx
  on investor_reevaluation_conditions (investor_catalog_entity_id, org_id, condition_kind)
  where fulfilled_at is null and definitive_pass is false;

alter table investor_reevaluation_conditions enable row level security;
-- Investor-private; obstacle/condition_kind never reach the founder (only
-- the TYPE OF MARKER the founder consented to watch, via the existing
-- investor_watches/investor_followups flow, which already carries no
-- private reasoning). Service-role only, no policy — same posture as
-- investor_signal_events (715).

-- investor_watch_alerts (Prompt 348/0227) traces back to the condition that
-- produced it, so the reapresentation step can find "which alerts are for
-- a reevaluation, not a plain threshold" without parsing fact_text.
alter table investor_watch_alerts add column if not exists condition_id uuid references investor_reevaluation_conditions(id) on delete cascade;

-- Prompt 716 Pedido C — "a reapresentação abre um presentation_cycle novo
-- dentro do episódio" — the 30-day progression-metric window (a FUTURE
-- fase's own concern) needs to know it restarted at reapresentation, not
-- at the episode's original opening. Added to 715's own table since it is
-- the same episode concept, not a second one.
alter table investor_opportunity_episodes add column if not exists presentation_cycle integer not null default 1;

comment on table investor_reevaluation_conditions is
  'Prompt 716 — "what would need to change to look again", one row per condition. Fulfillment is checked deterministically per condition_kind (see reevaluation-conditions.ts) — never by a language model.';
