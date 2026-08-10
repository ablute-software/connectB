-- Prompt 147 §4 — lets a profile owner selectively hide a handful of
-- optional, self-reported mini-pitch fields from the deck card without
-- deleting the underlying data (still visible to the owner in ProfilePanel,
-- still stored, just not rendered on CardFace). Purely additive column,
-- default '{}' so every existing row (and every existing reader of
-- matchdeal_profiles) is unaffected until a profile owner opts in.
--
-- No RLS change: matchdeal_profiles' existing self-update policy already
-- lets a profile's own org member write any column on it (ProfilePanel.tsx
-- already does `.update(...)` on this table for website/description/etc.
-- under that same policy) — hidden_fields is just one more column it covers.
--
-- No RPC change: matchdeal_eligible_deck is `returns setof matchdeal_profiles`
-- with no column projection (see MatchDealDeck.tsx's own comment on
-- MatchDealProfile), so this new column reaches the deck's client payload
-- automatically. Filtering on it happens client-side in CardFace/
-- StartupMiniPitch (MatchDealDeck.tsx) — a display preference, not a hard
-- privacy boundary enforced at the RPC layer; flagged as a deliberate scope
-- choice, not an oversight, in the Prompt 147 delivery report.
--
-- Closed vocabulary enforced by the CHECK, not a free-form tag list: the
-- only values ProfilePanel.tsx's checkboxes ever write are the 5 below,
-- each mapping 1:1 to a field that is BOTH editable in ProfilePanel.tsx AND
-- actually rendered on CardFace today (checked directly in code before
-- picking this list — e.g. matchdeal_profiles.team_summary was excluded
-- because it's edited in ProfilePanel.tsx but never rendered anywhere on
-- the swipe-deck card, only on the founder-facing portal dossier — hiding
-- it from the deck would be a no-op, misleading as an option).
alter table public.matchdeal_profiles
  add column hidden_fields text[] not null default '{}';

alter table public.matchdeal_profiles
  add constraint matchdeal_profiles_hidden_fields_vocabulary check (
    hidden_fields <@ array['ticket', 'stages', 'geographies', 'specific_criteria', 'market_projections']::text[]
  );
