-- Prompt 387 §D — "cartões que colocam questões pertinentes" (Nuno's own
-- words): the same Watson pass that proposes complete events (Prompt 359
-- Block D) can now ALSO propose up to 3 open questions, shown only when
-- there are no pending event suggestions to prioritize. A question has no
-- date of its own — the date is the founder's own answer — so `date`
-- becomes nullable, gated by `kind`: still required for a real event,
-- never for a question. Same unique(org_id, signature)/status lifecycle
-- as an event suggestion — a dismissed question never comes back, an
-- answered one (via "Add as event") is marked 'added' exactly like today.
alter table roadmap_event_suggestions
  add column if not exists kind text not null default 'event' check (kind in ('event', 'question'));

alter table roadmap_event_suggestions alter column date drop not null;

alter table roadmap_event_suggestions drop constraint if exists roadmap_event_suggestions_date_required_for_event;
alter table roadmap_event_suggestions add constraint roadmap_event_suggestions_date_required_for_event
  check (kind = 'question' or date is not null);

comment on column roadmap_event_suggestions.kind is
  'Prompt 387 §D — ''event'' (Prompt 359''s original, complete event proposal) or ''question'' (a founder-facing prompt with no date of its own — the answer supplies one).';
