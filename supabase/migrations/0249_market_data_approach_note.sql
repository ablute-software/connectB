-- Prompt 384 §B.4 — "How we'll take it": the founder's own answer to the
-- half of §0's root question no ring/number answers alone — HOW the startup
-- will approach the market and in what timeframe. Content DECLARED by the
-- founder, same class as round_progress_visible_to_investors (migration
-- 0174) and the intro_problem/intro_solution pitch fields (0218) — never
-- platform-derived performance, so the CLAUDE.md root privacy rule (which
-- only forbids the latter) doesn't apply here. 600-char cap, same discipline
-- as those two: enforced here AND re-validated server-side in the route,
-- never trusting the client alone (this file's own convention, see
-- 0218/0219/0237 for the same char_length(...) <= N pattern).
alter table org_market_data
  add column if not exists approach_note text check (approach_note is null or char_length(approach_note) <= 600);

comment on column org_market_data.approach_note is
  'Prompt 384 §B.4 — founder-declared "how we''ll take it" note, shown on the Market analysis view and, when the rings group is published, in the investor dossier (market.approach).';
