-- Prompt 893 §D (29/09/2026) — "How we pitch this firm" (entities.our_angle)
-- is written by TWO different authors today and the dossier could not tell
-- them apart: the founder, typing it by hand, and
-- src/app/api/market-data/bridge/add-target/route.ts, which pre-writes
-- `They <hookLine>.` automatically whenever "Follow now" adds an investor
-- via a competitor-investment match. Nuno's own test (29/09/2026, Insight
-- Venture) is what surfaced this — he read an automated suggestion as his
-- own prior note with no way to tell otherwise.
--
-- A nullable enum-shaped text column, not a boolean: `founder` is set the
-- moment a founder edits the field (PitchAndAskFields.tsx), `sherlock` is
-- set only by the one automated writer above, and every row that predates
-- this migration is NULL — the app treats NULL the same as 'founder' (no
-- provenance badge shown), never the same as 'sherlock' (see
-- src/lib/types.ts's own comment on this field and
-- PitchAndAskFields.tsx's rendering).
--
-- A text prefix convention (e.g. "[Sherlock] They ...") was explicitly
-- rejected for this — see the Prompt 893 delivery report — because it
-- mixes the data with its own label, corrupting the literal value Watson
-- and the form assistant read straight out of this column today.
--
-- NOT applied to any live database by this session — a migration file
-- only, for Nuno's own reconciliation, per this repo's standing rule.
alter table public.entities
  add column if not exists our_angle_source text
    check (our_angle_source is null or our_angle_source in ('founder', 'sherlock'));

comment on column public.entities.our_angle_source is
  'Prompt 893 §D — who last wrote our_angle: ''founder'' (edited by hand) or ''sherlock'' (written automatically by the market-data bridge''s add-target route). NULL for every pre-migration row and treated the same as ''founder'' by the app (no provenance badge).';
