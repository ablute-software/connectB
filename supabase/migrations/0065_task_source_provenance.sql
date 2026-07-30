-- Log interaction, next-action engine (prompt 65, Bloco 4). Tracks whether
-- a follow-up task came from the founder's own typed text ('manual') or
-- from the relationship engine's suggestion, accepted as-is or after edits
-- ('suggested') — so it's later possible to measure whether the engine's
-- suggestions are actually useful or are being routinely overridden.
-- Nullable: every task created before this ships has no provenance opinion,
-- which is honest (we don't know) rather than guessing.
alter table tasks add column if not exists source text check (source is null or source = any (array['suggested','manual']));
