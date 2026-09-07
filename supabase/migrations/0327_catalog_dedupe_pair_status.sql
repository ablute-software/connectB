-- Prompt 580b §A — decisions per PAIR, not per group: "Same firm" (a
-- merge, no new state needed — the merge itself is the record), "Not the
-- same" (already exists: catalog_dedupe_dismissals, migration 0318), and
-- the missing third state, "Not sure" — a pair that stays in the group
-- (unlike a dismissal, which removes the edge) but stops being proposed
-- as an automatic same-firm match and carries a visible "not sure · date
-- · admin" label.
--
-- Reused this table rather than a new one: "not the same" and "not sure"
-- are the exact same shape (a pair, an optional/required note, who and
-- when) — only the status differs, and only status changes what the
-- dedupe route DOES with the row (a 'not_same' pair is excluded from
-- findDuplicateClusters' union-find, i.e. the edge is gone; an
-- 'uncertain' one is not — the group stays whole, per the prompt's own
-- §A.1 "o par fica no grupo"). reason becomes optional because "Not
-- sure" explicitly allows no note ("nota opcional"); "Not the same"
-- keeps requiring one, enforced at the route (same "never only a DB
-- constraint" pattern this table's admin-write gate already uses).
alter table catalog_dedupe_dismissals
  add column if not exists status text not null default 'not_same' check (status in ('not_same', 'uncertain')),
  alter column reason drop not null;

comment on column catalog_dedupe_dismissals.status is
  'not_same: the pair is dismissed — its edge is excluded from findDuplicateClusters, splitting the group. uncertain: the pair stays in the group (no edge removed), labeled and excluded from auto-merge-proposal, revisitable via the Unsure filter.';
