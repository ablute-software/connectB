-- Prompt 325 — the only text an investor sees before deciding to click
-- "Interested" today is orgs.one_liner (via matchdeal_profiles.description,
-- the same one line). Two new, optional, founder-authored fields give a
-- concrete reason to click: a one-sentence problem statement and a
-- one-sentence solution statement, ADDITIONAL to one_liner (never a
-- replacement — a founder who never fills these in sees no regression).
-- Safe at Discovery (Level 0) by design: this is the exact equivalent of a
-- public pitch-deck summary line, no numbers, no traction, nothing the
-- root privacy rule protects — enforced app-side by never letting these two
-- fields grow past a short cap (INTRO_PITCH_MAX, investor-interest-level.ts),
-- mirrored here as a DB-level backstop.
alter table orgs
  add column if not exists intro_problem text check (intro_problem is null or char_length(intro_problem) <= 240),
  add column if not exists intro_solution text check (intro_solution is null or char_length(intro_solution) <= 240);
