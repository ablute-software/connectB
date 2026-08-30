-- Prompt 481 §2/§7 — manual entry for the Capital Landscape, and the
-- provenance that has to travel with every row.
--
-- What the required "what exists today" check found, because it changes
-- what this migration needs to be:
--   - Prompt 460 did NOT drop players/rounds for unreliable data; it
--     removed menu entries that pointed at a static placeholder. The real
--     ComparableRoundsCard is live and rendered today.
--   - Rounds already merge two sources server-side (market-rounds-merge.ts):
--     investor_investments (a tracked competitor's funding history) and
--     accepted `rounds` web-research items. Per-item provenance already
--     existed there.
-- So the public-search half of §1 is the mechanism that already runs, and
-- the only storage genuinely missing was the founder's own entries. This
-- table is that, and nothing more — rebuilding the researched half here
-- would have created a second path to the same data, which is the mistake
-- D2 existed to undo.
--
-- Investor visibility (§6): this table is founder-only and is deliberately
-- NOT read by dossier-fetch.ts. The investor dossier's `rounds` group reads
-- investor_investments alone, already behind the explicit visibleGroups
-- publication gate ("Closed by default"). Nothing here crosses to an
-- investor unless a future prompt deliberately publishes it — and when it
-- does, §6 requires the warnings to travel with it exactly as the founder
-- sees them.
--
-- STRICTLY ADDITIVE (AUTONOMOUS_EXECUTION_MODE_v2 §12): one new table, no
-- existing table touched, no backfill.
-- Rollback: `drop table org_capital_landscape_rounds;` — read behind a
-- capability probe that fails closed (no table, no manual rounds, the card
-- shows exactly what it shows today).
create table if not exists org_capital_landscape_rounds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  company_name text not null,
  investor_name text,
  amount_eur bigint,
  round_type text,
  -- Free text rather than a date: a founder who only knows "March 2026"
  -- must be able to say so. Validated as parseable before it is stored
  -- (sanitizeManualRound) so it still sorts, but never forced to a
  -- precision the founder does not actually have.
  invested_at text,
  source_url text,
  -- §7 — provenance per ITEM, never per section. 'manual' is the only value
  -- this table ever holds (the other sources live in their own tables); the
  -- column exists so a row read out of here in isolation still knows what
  -- it is, and so the check below makes that impossible to get wrong.
  source text not null default 'manual' check (source = 'manual'),
  -- §7 — "e quando", so the founder can tell an old entry from a recent one.
  created_at timestamptz not null default now(),
  check (char_length(company_name) > 0),
  check (amount_eur is null or amount_eur >= 0)
);

create index if not exists org_capital_landscape_rounds_org_idx on org_capital_landscape_rounds(org_id, created_at desc);

alter table org_capital_landscape_rounds enable row level security;

drop policy if exists org_capital_landscape_rounds_org_members on org_capital_landscape_rounds;
create policy org_capital_landscape_rounds_org_members on org_capital_landscape_rounds
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table org_capital_landscape_rounds is
  'Prompt 481 §2 — rounds the founder entered by hand. Founder-only: never read by dossier-fetch, so nothing here reaches an investor without a deliberate future publication step. Always carries the manual-entry warning (capital-landscape.ts).';
