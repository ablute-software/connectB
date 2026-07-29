-- Deep investor-enrichment data (prompt 45). Applied 2026-07-29.
--
-- Superseded design: an earlier draft of this migration created four
-- catalog_id-anchored investor_intel_* tables for the whole batch (entity
-- facts + people + signals + sources). Replaced per Nuno's 2026-07-29
-- guidance: reuse what already exists instead of building parallel storage.
--
-- 1. PESSOAS sheet -> no new table. `people`/`person_affiliations` already
--    carry hook, hook_status, kill_words, watch_outs, background, intro_path,
--    linked_companies, role/title — nearly 1:1 with the sheet's columns, and
--    it's the same table Grant Access and the outreach flow already read.
--    No DDL needed here; see the importer-script mapping note below.
--
-- 2. ENTIDADES sheet's assessment fields (fit, outreach recommendation,
--    activity status) -> entity_outreach_assessments (new). NOT columns on
--    entities/catalog_entities: this is a dated judgment call ("as of this
--    batch"), not a fixed fact, and re-running a future batch should be able
--    to show "what did we think last time vs now" rather than clobbering a
--    single value.
--
-- 3. SINAIS_HOOKS and FONTES sheets -> entity_outreach_signals and
--    entity_enrichment_sources (new), genuinely one-to-many, evidence-level
--    granularity that doesn't belong flattened into #2.
--
-- Anchor choice — entity_id (org's pipeline row), NOT catalog_id (platform-
-- wide company): unlike the superseded design, fit/outreach/avoid-notes are
-- inherently about OUR raise (ablute_'s thesis, ablute_'s existing pipeline
-- notes to correct), not a fact about the company usable by any org. Anchoring
-- on catalog_id and making it platform-readable (the old design's approach)
-- would leak one org's outreach strategy to any other org with the same
-- catalog entity in their pipeline — a real privacy problem, not just a
-- modeling nicety. catalog_id is kept as a secondary, nullable reference for
-- cross-batch dedup/lookup convenience only, never the RLS anchor.
--
-- Resolved 2026-07-29: entities.fit_score (enum: high/medium_high/medium/
-- low, shown on /pipeline) and entities.alignment_status/alignment_notes
-- (§11d misalignment alert, computed by computeAlignment() in
-- company-canon-logic.ts) already exist and are name-adjacent to what this
-- batch produces. Neither is touched by the importer, by design, not
-- oversight: alignment_status is a narrow automated consistency check (does
-- the entity's stated thesis still match our own confirmed canon facts), a
-- different thing from a researched "is this a good fit" judgment call —
-- conflating them would risk the automated recompute silently overwriting
-- researched input. entities.fit_score IS a plausible match for this
-- batch's adequacao_tematica_0_10, but Nuno chose never to auto-sync it:
-- two of the three batch-01 entities already carry a founder-set fit_score
-- (Pathena=low, COREangels=medium_high), and an automatic sync would
-- silently overwrite that judgment. The batch's own score lives only in
-- entity_outreach_assessments.fit_score; entities.fit_score stays
-- founder-controlled, always.

create table entity_outreach_assessments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  catalog_id uuid references catalog_entities(id) on delete set null,
  fit_score numeric,           -- adequacao_tematica_0_10 (0-10, raw — not the entities.fit_score enum)
  outreach_score numeric,      -- acionabilidade_outreach_0_10 (0-10)
  recommendation text,         -- recomendacao_outreach
  activity_status text,        -- estado_atividade (free text: batch vocabulary not fixed enough yet for an enum)
  thesis_correction text,      -- correcao_tese (vs. our existing pipeline notes)
  avoid_notes text,            -- evitar_na_abordagem (entity-level; distinct from a person's own evitar)
  hook_recommended text,       -- hook_recomendado (entity-level suggested hook)
  confidence_facts numeric,    -- confianca_factos_0_1
  confidence_hook numeric,     -- confianca_hook_0_1 — kept separate from confidence_facts rather than
                                -- collapsed into one number: the source distinguishes "sure this fact is
                                -- true" from "sure this hook will land", which are different claims.
  notes text,                  -- catch-all for fields with no structured home yet (aliases, relação com
                                -- outras entidades, tese existente na base at assessment time)
  assessed_at date,            -- verificado_em
  batch_id text not null,
  created_at timestamptz not null default now()
);
-- Re-importing the SAME batch updates this row (idempotent); a later batch
-- (different batch_id) inserts a new row, preserving history per requirement #4.
create unique index on entity_outreach_assessments (entity_id, batch_id);
create index on entity_outreach_assessments (entity_id);
create index on entity_outreach_assessments (catalog_id);

create table entity_outreach_signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  person_id uuid references people(id) on delete cascade, -- null = signal about the org itself, no specific person
  observed_at text,      -- data_publicacao — free text, not date: source mixes real dates, year-only, "current"
  source_type text,      -- tipo_fonte
  category text,         -- categoria
  signal text not null,  -- sinal_observado
  inference text,        -- inferencia_de_abordagem
  suggested_hook text,   -- hook_sugerido
  confidence numeric,    -- confianca_0_1
  source_url text,       -- fonte_url
  batch_id text not null,
  created_at timestamptz not null default now()
);
-- No natural per-row key across batches -> importer deletes and reinserts
-- this entity's rows for this batch_id on reimport (same pattern as before).
create index on entity_outreach_signals (entity_id, batch_id);
create index on entity_outreach_signals (person_id);

create table entity_enrichment_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  person_id uuid references people(id) on delete cascade,
  source_url text not null,
  source_type text,   -- tipo
  published_at text,  -- data_publicacao, free text (see entity_outreach_signals.observed_at)
  verified_at date,   -- verificado_em
  supports text,      -- suporta — which claim/row this source backs
  quality text,       -- qualidade
  notes text,         -- observacoes
  batch_id text not null,
  created_at timestamptz not null default now()
);
create index on entity_enrichment_sources (entity_id, batch_id);

alter table entity_outreach_assessments enable row level security;
alter table entity_outreach_signals enable row level security;
alter table entity_enrichment_sources enable row level security;

-- Assessments and signals: same org-member access as every other org-scoped
-- table (entities, people, interactions, ...) — this is the founder's own
-- outreach research, not platform-wide catalog intel.
create policy entity_outreach_assessments_all on entity_outreach_assessments
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy entity_outreach_signals_all on entity_outreach_signals
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Sources/audit trail stays back-office-only, per the original privacy
-- discipline for the FONTES sheet — provenance for judging data quality,
-- not outreach material a founder needs day-to-day.
create policy entity_enrichment_sources_admin_only on entity_enrichment_sources
  for all using (is_platform_admin()) with check (is_platform_admin());

-- Privacy rule from the prompt, enforced structurally: nothing here has a
-- dedicated column for family/health/religion/politics — every field is
-- either a professional-fact free-text column or a numeric confidence
-- score. The importer script is still the actual enforcement point, this is
-- defense in depth, not a substitute.
