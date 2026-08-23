-- Prompt 334 — the MatchDeal mini-pitch: 5 auto-generated slides synthesized
-- from company_claims (Prompt 219) + profile fields, shown to an investor at
-- Level 1 (the same unlock point as the dossier overview, P136).
--
-- One row per org — a generation replaces the previous one outright (this is
-- always "the current mini-pitch", never a history). `activated_at` is the
-- publish gate: a founder can generate/preview repeatedly before ever
-- activating (see the API route), and dossier-fetch.ts only ever reads this
-- row for an investor when activated_at is not null. Regenerating an
-- already-activated pitch keeps it live (no re-approval step) — activated_at
-- is only ever set, never cleared, by a later generation.
--
-- `slides` stores the FULL shape (kind/title/body/claimIds) including which
-- claim ids back each slide, since the founder's own preview shows evidence-
-- class reasoning ("why this claim was picked") that an investor must never
-- see (src/lib/mini-pitch.ts's projectMiniPitchForInvestor strips that at
-- read time, in code — this table is not the place that enforces it).
--
-- `input_snapshot` is the exact JSON string mini-pitch.ts's own
-- computeMiniPitchInputSnapshot produced at generation time — a plain string
-- compare against a freshly computed snapshot is the entire staleness check,
-- no separate "stale" boolean to fall out of sync.
create table if not exists org_mini_pitches (
  org_id uuid primary key references orgs(id) on delete cascade,
  slides jsonb not null,
  input_snapshot text not null,
  generated_at timestamptz not null default now(),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table org_mini_pitches enable row level security;

-- Read-only for the org's own members (defense in depth — every route that
-- actually serves this data, founder-side or investor-side, reads through
-- the service-role admin client, same as company_badges/company_claims).
-- No insert/update policy: generation always happens server-side.
create policy org_mini_pitches_select_own_org on org_mini_pitches
  for select using (is_org_member(org_id));
