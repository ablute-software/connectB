-- Prompt 853 §2 — closing the revert loop on a pass that closes a
-- relationship (entities.status: 'passed' + relationship_state.stage:
-- 'decision', from RelationshipSummaryCard's "No interest / over"). Before
-- this, the only undo was the transient toast (`undoStageChange`) that
-- vanishes on the next page load — 852 §D.3 asked for revertibility and
-- this is the schema it needs.
--
-- Do NOT guess the previous state at revert time: record it at PASS time
-- instead, on the pass interaction itself — the closest existing "decision
-- record" for a pass (there is no separate table for it, unlike §A's
-- startup_investor_decisions). previous_stage is looked up via getStage()
-- (relationship.ts), which already derives a concrete stage even when no
-- relationship_state row exists yet, so this is never ambiguous.
--
-- reverted_at/reverted_by mirror startup_investor_decisions' own pair
-- (migration 0340) exactly, extended to the SAME row rather than a new
-- table — reverting never deletes the interaction, so the pass reason
-- stays legible in history and in the back-office "Passes / Over" tab,
-- struck through with its revert date.
alter table interactions
  add column if not exists previous_status entity_status,
  add column if not exists previous_stage relationship_stage,
  add column if not exists reverted_at timestamptz,
  add column if not exists reverted_by uuid references auth.users(id);

comment on column interactions.previous_status is
  'Prompt 853 §2 — entities.status immediately before this pass closed the relationship. Set only for the pass-and-close flow; null means nothing was recorded (predates this migration, or a different pass origin) and no revert should be offered.';
comment on column interactions.previous_stage is
  'Prompt 853 §2 — relationship_state.stage (via getStage()) immediately before this pass. Paired with previous_status; both null or both set.';
comment on column interactions.reverted_at is
  'Prompt 853 §2 — when a pass was reverted. The row is never deleted: history stays honest, and the back-office shows it struck through.';
comment on column interactions.reverted_by is
  'Prompt 853 §2 — who reverted the pass.';
