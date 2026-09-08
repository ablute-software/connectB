-- Prompt 616 §B.1, second half — the 3 472 rows that are already there.
--
-- "inferir a partir do entity_id e da corrida de enriquecimento que as criou —
-- e marcar como INFERIDA, não como registada. Uma origem inventada é pior do
-- que um campo vazio; a diferença aparece no dia em que alguém perguntar."
--
-- So this writes source_confidence = 'inferred' on every row it touches, and
-- infers only what the row itself can support:
--   * a stored LinkedIn URL means the entry came from a public profile, and
--     the URL is the source;
--   * anything else that was enriched came from the enrichment run over the
--     firm, and the firm is as specific as we can honestly be.
-- A row supporting neither is left NULL: "we do not know" is a true answer and
-- a guess is not.
--
-- Applied result: 1 883 public_profile + 1 589 enrichment_run = 3 472, none
-- marked 'recorded'.
update public.catalog_people
set source_kind = 'public_profile',
    source_url = linkedin_url,
    source_confidence = 'inferred',
    source_recorded_at = coalesce(enriched_at, created_at)
where source_confidence is null
  and linkedin_url is not null;

update public.catalog_people
set source_kind = 'enrichment_run',
    source_confidence = 'inferred',
    source_recorded_at = coalesce(enriched_at, created_at)
where source_confidence is null
  and entity_id is not null
  and enrichment_status is not null;
