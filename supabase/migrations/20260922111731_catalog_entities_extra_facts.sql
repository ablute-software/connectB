-- Prompt 662 §3 (Nuno, 22/09) — the ~33 real investor facts the ENTIDADES
-- sheet carries with no column of their own (warm_intro_required,
-- decision_time, business_model, and the rest): one jsonb "ficha" field,
-- not a migration per fact. Same mechanical shape as catalog_entities'
-- existing verified_fields (20260909203000) — jsonb, not null, default
-- '{}' — but a richer per-entry value, because these facts are never just
-- "known": NOT_PUBLIC ("looked, isn't published") and CONFLICT ("two
-- sources disagree") are states an importer must preserve, never collapse
-- into an indistinguishable null or "pick the latest".
--
-- Shape (per key, key = the source field name from the canonical registry
-- in src/lib/catalog-entity-extra-facts.ts, never invented ad hoc by an
-- importer):
--   { "value": <any>, "status": "known" | "not_public" | "conflict" | "conditional",
--     "source": text, "checked_at": text, "note": text }
-- Not enforced by a CHECK here — same choice verified_fields already made
-- (its own shape isn't constraint-validated either) — the registry and the
-- pure validator in code are the one place either can drift, checked by a
-- unit test instead of a trigger.
--
-- Promotion to a real column happens only when a consumer (the matching
-- engine) actually reads the field — not speculatively, not on import.

alter table public.catalog_entities
  add column if not exists extra_facts jsonb not null default '{}'::jsonb;

comment on column public.catalog_entities.extra_facts is
  'Prompt 662 §3 — investor facts with no column of their own, keyed by the canonical field-name registry (src/lib/catalog-entity-extra-facts.ts). Each value is {value, status: known|not_public|conflict|conditional, source, checked_at, note} — NOT_PUBLIC and CONFLICT are states, never collapsed to null or "latest wins". Same jsonb/default/no-CHECK convention as verified_fields (20260909203000). A key gets promoted to a real column only once something actually reads it.';

create index if not exists catalog_entities_extra_facts_gin
  on public.catalog_entities using gin (extra_facts);
