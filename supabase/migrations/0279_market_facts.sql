-- Prompt 467 — "O founder disse" ≠ "o Sherlock verificou que é verdade."
-- North Star invariables 1 (claims and market facts are different objects),
-- 2 (a single shared evidence layer), 11, 13, 14.
--
-- v1 of this prompt let growth/market_size numbers extracted from the
-- founder's OWN deck become `validation_status: 'valid'` market facts,
-- presented as Market Intelligence. That collapses "the founder asserts
-- 8% growth" into "the market grows at 8%" — exactly the invariable-1
-- violation the North Star exists to prevent. This migration is additive
-- only (no column added to market_research_items, no row updated) and
-- introduces FOUR new tables (v1 said "three" and then defined four —
-- corrected here) carrying two INDEPENDENT axes on every fact: whether it
-- is well-formed (validation_status), and what we know about whether it is
-- TRUE (verification_status, derived from evidence origin — never the
-- same field, invariable 13).
--
-- THIS MIGRATION IS PREPARED AND COMMITTED, NOT APPLIED. Nuno approves
-- before it touches production — see the application/rollback plan
-- delivered alongside this file.
--
-- Same RLS/policy/comment shape as roadmap_event_suggestions (0238) and
-- document_link_snapshots (0278): RLS on, is_org_member(org_id) policy,
-- table comment. Reversal is `drop table` of the four, in dependency order
-- (see rollback plan) — no data migration to undo, nothing else references
-- these tables yet.

-- market_evidence — the shared provenance layer (North Star §2). Cheap to
-- add now, expensive to retrofit once facts/claims/the published dossier
-- all depend on it — so it carries origin, source kind, retrieval method
-- and visibility from day one, even though only 'founder_document' /
-- 'pitch_deck' / 'vault_extraction' is ever written by THIS prompt's own
-- pipeline (§C). Every other combination exists for the evidence layer's
-- future readers (web research, external reports — explicitly out of
-- scope here), not invented for their own sake.
--
-- evidence_fingerprint, not unique(org_id, document_id, page, quote):
-- tested directly against the real production database (Nuno, 2026-08-29)
-- — a plain UNIQUE constraint accepts multiple NULLs in Postgres. Two rows
-- with page/quote both null both passed. v1 of this prompt claimed the
-- opposite as "a database invariable"; that was false. The fingerprint is
-- NOT NULL and deterministic (document_id|page|quote normalized, or
-- source_url|quote — see market-facts-db.ts's computeEvidenceFingerprint),
-- so a `quote = null` reading of the same document+page still collapses to
-- one row, and it works identically for web evidence with no document_id
-- at all. Hashed rather than the raw locator so a long quote is never what
-- gets indexed.
create table if not exists market_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  evidence_fingerprint text not null,
  document_id uuid references documents(id) on delete set null,
  page int,
  quote text,
  source_url text,
  published_at date,
  origin text not null check (origin in ('founder_document', 'sherlock_web', 'external_report')),
  source_kind text not null check (source_kind in ('pitch_deck', 'internal_doc', 'market_report', 'press', 'company_site', 'filing', 'other')),
  retrieval_method text not null check (retrieval_method in ('vault_extraction', 'link_snapshot', 'web_fetch', 'manual_entry')),
  visibility text not null default 'private' check (visibility in ('private', 'publishable', 'published')),
  created_at timestamptz not null default now(),
  unique (org_id, evidence_fingerprint)
);

create index if not exists market_evidence_org_idx on market_evidence(org_id);

alter table market_evidence enable row level security;

drop policy if exists market_evidence_org_members on market_evidence;
create policy market_evidence_org_members on market_evidence
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table market_evidence is
  'Prompt 467 §A — the shared evidence layer (North Star §2): origin, source kind, retrieval method and visibility for every piece of provenance a market_fact, and later a claim or the published dossier, can point to. evidence_fingerprint (NOT NULL, deterministic) replaces a plain unique(document_id,page,quote) because Postgres UNIQUE accepts multiple NULLs — confirmed empirically against production.';

-- market_facts — typed propositions with TWO axes that must never collapse
-- into one (invariable 13):
--   validation_status — EIXO 1, structure only: is the object well-formed.
--   verification_status — EIXO 2, epistemology: what we know about whether
--     it is true. Derived deterministically from the origins of the
--     evidence behind the fact (see market-facts-db.ts's
--     deriveVerificationStatus) — never written by hand, never by a model
--     (invariable 9: the model extracts, the logic decides).
-- A number lifted straight from the founder's own deck is routinely BOTH
-- validation_status='valid' (well-formed) AND verification_status=
-- 'founder_reported' (nobody outside the founder has confirmed it) — that
-- combination is the normal, expected case for this prompt's own pipeline,
-- not an edge case.
--
-- fact_fingerprint gives a fact stable identity across separate extraction
-- runs: deterministic over normalized market_definition + geography +
-- metric + period (or as_of_year) + estimateShape + value/lowerBound/
-- upperBound (see market-facts-db.ts's computeFactFingerprint). Two
-- sources that disagree (8% vs 12%, same market and period) stay TWO
-- facts — that disagreement is exactly what a founder or a later reader
-- should see, never silently merged into one. The same proposition
-- reextracted five times stays one fact and accumulates observations.
create table if not exists market_facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  fact_type text not null check (fact_type in ('growth', 'market_size')),
  fact_fingerprint text not null,
  payload jsonb not null,
  validation_status text not null check (validation_status in ('valid', 'incomplete', 'invalid')),
  validation jsonb not null,
  -- 'conflicting' deliberately excluded (v3, Nuno's review): a real
  -- conflict is a relationship between TWO SIBLING facts sharing context
  -- but disagreeing on value (fact_fingerprint bakes value in, so
  -- disagreeing sources are always two rows here, never one) — it can
  -- never be a property this table's own evidence-origin derivation
  -- produces for a single fact. Leaving the value in the enum ahead of
  -- that cross-fact mechanism existing would invite writing it by hand,
  -- exactly the "derived, not hand-written" rule this axis exists to
  -- enforce. Add it back only alongside the code that actually computes it.
  verification_status text not null check (verification_status in ('founder_reported', 'externally_sourced', 'corroborated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, fact_type, fact_fingerprint)
);

create index if not exists market_facts_org_idx on market_facts(org_id, verification_status);

alter table market_facts enable row level security;

drop policy if exists market_facts_org_members on market_facts;
create policy market_facts_org_members on market_facts
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table market_facts is
  'Prompt 467 §A — typed market propositions (growth/market_size today). Two orthogonal axes, never collapsed: validation_status (well-formed?) and verification_status (do we know it is TRUE? — derived from evidence origin, never hand-written). unique(org_id, fact_type, fact_fingerprint) gives idempotence across repeated extraction runs.';

-- market_fact_observations — the history AND the lineage. One row per raw
-- candidate that fed a fact, NEVER deduplicated (an audit trail, unlike
-- market_evidence which collapses repeat readings of the same locator).
--
-- legacy_item_id is the ONLY path into market_research_item_supersessions
-- (below) — set only when there is a TRUE, verified provenance link from
-- this observation to that exact legacy row. v3 (Nuno's review) retracts
-- an earlier claim that matching market_research_items' own dedup key —
-- (org_id, section, title) — counted as "by construction" identity: it
-- does not. That key exists to stop the SAME extraction run reproposing
-- an identical title, not to prove that two candidates from SEPARATE runs
-- (possibly different documents) describing the same rounded number
-- ("Growth: 8% annual") are the same real-world assertion — invariable 14
-- again: a shared title is not positive proof of identity, and matching on
-- it would risk superseding the wrong card. §C's own automatic pipeline
-- therefore never sets this column; it stays null (no supersession row)
-- until a deliberately verified cutover — human-confirmed, not
-- heuristic-inferred — sets it explicitly.
create table if not exists market_fact_observations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  market_fact_id uuid not null references market_facts(id) on delete cascade,
  evidence_id uuid not null references market_evidence(id) on delete cascade,
  extraction_run_id text not null,
  raw_candidate jsonb not null,
  legacy_item_id uuid references market_research_items(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists market_fact_observations_fact_idx on market_fact_observations(market_fact_id);
create index if not exists market_fact_observations_org_idx on market_fact_observations(org_id);

alter table market_fact_observations enable row level security;

drop policy if exists market_fact_observations_org_members on market_fact_observations;
create policy market_fact_observations_org_members on market_fact_observations
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table market_fact_observations is
  'Prompt 467 §A — one row per raw extraction candidate that fed a market_fact, never deduplicated (the audit trail — evidence dedup lives in market_evidence instead). legacy_item_id, set only on a positive-identity match against market_research_items, is the sole origin of a market_research_item_supersessions row — never a heuristic over document/page/value.';

-- market_research_item_supersessions — legacy artifact lifecycle, kept in
-- its OWN table because SUPERSEDED is not an epistemological state of a
-- market_fact (the two axes above stay independent of it). A legacy item
-- with no row here simply stays visible — "prefiro um cartão velho a mais
-- do que esconder um diferente" (§C), applied literally.
create table if not exists market_research_item_supersessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  legacy_item_id uuid not null references market_research_items(id) on delete cascade,
  market_fact_id uuid not null references market_facts(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (legacy_item_id, market_fact_id)
);

create index if not exists market_research_item_supersessions_org_idx on market_research_item_supersessions(org_id);

alter table market_research_item_supersessions enable row level security;

drop policy if exists market_research_item_supersessions_org_members on market_research_item_supersessions;
create policy market_research_item_supersessions_org_members on market_research_item_supersessions
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table market_research_item_supersessions is
  'Prompt 467 §A/§C — records that a legacy market_research_items row has been replaced by a typed market_fact, ONLY when the observation that produced the fact carried a positive-identity legacy_item_id. No row = the legacy card stays visible. SUPERSEDED is lifecycle of the legacy artifact, not a state of the market_fact itself.';

-- write_market_fact — the single atomic write point (§B). v1 of this
-- prompt said "in the same sequence" for the fact/evidence/observation
-- writes; sequence is not a transaction, and a failure partway through
-- would leave a market_fact with no evidence behind it — a fact for which
-- "Why do we know this?" has no answer. This RPC makes the fact upsert,
-- the evidence upsert, the observation insert, and (when legacy_item_id is
-- present) the supersession upsert happen inside ONE Postgres function
-- invocation, which is one transaction by construction — no BEGIN/COMMIT
-- needed. No business logic here: validation and verification_status
-- derivation are computed in TypeScript (market-facts-db.ts) and simply
-- passed in; this function only guarantees atomicity, same division of
-- labor as every other SECURITY DEFINER function in this codebase.
--
-- security definer + revoke from public/anon/authenticated, same shape as
-- link_claim_document_ref (0208) and the verification_* functions (0183):
-- called only via the service-role admin client from market-facts-db.ts,
-- which is itself the only file allowed to reach this table (enforced by
-- the no-fire-and-forget.test.ts guard extended in §B.5).
create or replace function public.write_market_fact(
  p_org_id uuid,
  p_fact_type text,
  p_fact_fingerprint text,
  p_payload jsonb,
  p_validation_status text,
  p_validation jsonb,
  p_verification_status text,
  p_observations jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_fact_id uuid;
  v_evidence_id uuid;
  v_obs jsonb;
  v_legacy_item_id uuid;
begin
  insert into public.market_facts
    (org_id, fact_type, fact_fingerprint, payload, validation_status, validation, verification_status, updated_at)
  values
    (p_org_id, p_fact_type, p_fact_fingerprint, p_payload, p_validation_status, p_validation, p_verification_status, now())
  on conflict (org_id, fact_type, fact_fingerprint) do update set
    payload = excluded.payload,
    validation_status = excluded.validation_status,
    validation = excluded.validation,
    verification_status = excluded.verification_status,
    updated_at = now()
  returning id into v_fact_id;

  for v_obs in select * from jsonb_array_elements(coalesce(p_observations, '[]'::jsonb))
  loop
    insert into public.market_evidence
      (org_id, evidence_fingerprint, document_id, page, quote, source_url, published_at, origin, source_kind, retrieval_method)
    values (
      p_org_id,
      v_obs->>'evidence_fingerprint',
      nullif(v_obs->>'document_id', '')::uuid,
      nullif(v_obs->>'page', '')::int,
      v_obs->>'quote',
      v_obs->>'source_url',
      nullif(v_obs->>'published_at', '')::date,
      v_obs->>'origin',
      v_obs->>'source_kind',
      v_obs->>'retrieval_method'
    )
    on conflict (org_id, evidence_fingerprint) do update set org_id = excluded.org_id
    returning id into v_evidence_id;

    v_legacy_item_id := nullif(v_obs->>'legacy_item_id', '')::uuid;

    insert into public.market_fact_observations
      (org_id, market_fact_id, evidence_id, extraction_run_id, raw_candidate, legacy_item_id)
    values
      (p_org_id, v_fact_id, v_evidence_id, v_obs->>'extraction_run_id', coalesce(v_obs->'raw_candidate', 'null'::jsonb), v_legacy_item_id);

    -- Supersession is born from lineage ONLY — this is the exact and only
    -- place a market_research_item_supersessions row is created, and only
    -- when the CALLER supplied a legacy_item_id (which §C's automatic
    -- pipeline never does — see market_fact_observations' own comment
    -- above). The reason text deliberately does not describe a mechanism:
    -- this function has no way to know HOW the caller established the
    -- match, and asserting one it didn't verify is exactly the mistake v3
    -- of this migration corrects.
    if v_legacy_item_id is not null then
      insert into public.market_research_item_supersessions (org_id, legacy_item_id, market_fact_id, reason)
      values (p_org_id, v_legacy_item_id, v_fact_id, 'legacy_item_id supplied by the caller of write_market_fact as a verified positive match')
      on conflict (legacy_item_id, market_fact_id) do nothing;
    end if;
  end loop;

  return v_fact_id;
end;
$function$;
revoke all on function public.write_market_fact(uuid, text, text, jsonb, text, jsonb, text, jsonb) from public, anon, authenticated;
