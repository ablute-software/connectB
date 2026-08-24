-- Prompt 358 Phase 1 — the mechanical half of "a gap closed by a non-
-- documentary answer must never resurface and must never become a junk
-- claim." Confirmed live (Nuno's own session): answering a gap question
-- with a chip like "Not yet" or "No document yet" was inserted VERBATIM as
-- a brand-new company_claims row (source_kind='founder_answer', status=
-- 'accepted') — which, for a documentable category, immediately re-tripped
-- G4 ("accepted but undocumented"), so the queue grew while the founder
-- was answering it.
--
-- gap_disposition records the founder's own decision about ONE EXISTING
-- claim's evidence story, without ever creating a second claim to hold it:
--   'no_document'      — G4 "No document yet": the claim is true, the
--                        founder confirms no document exists/will exist.
--                        Permanently suppresses G4 for this claim.
--   'document_pending' — G4 "It exists but is not in the Vault yet": same
--                        suppression, distinct value so a future "Vault
--                        checklist" surface (Phase 3) can list these
--                        separately from a genuinely closed gap.
--   'confirmed'        — G5 "Still true" / G7 "Confirmed, it stays as-is":
--                        the founder re-affirmed the claim without adding
--                        new corroborating material. Read alongside
--                        updated_at (which the same answer refreshes) so
--                        G5 doesn't re-nag immediately, and by G7 so a
--                        confirmed-isolated claim stops being flagged as
--                        isolated.
-- NULL (default) — no disposition recorded; every existing row reads as
-- exactly what it already was.
alter table company_claims
  add column if not exists gap_disposition text
    check (gap_disposition is null or gap_disposition in ('no_document', 'document_pending', 'confirmed'));
