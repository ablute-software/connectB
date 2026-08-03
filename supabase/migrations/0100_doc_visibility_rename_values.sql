-- Prompt 103 Bloco 3 / Prompt 104 #3 — reconciles Prompt 103's lock-icon
-- scheme with Prompt 104's proposed 3-value set (confirmed by Nuno: no 4th
-- "fully private, not even requestable" state). Pure rename, no new values,
-- no data migration needed. Confirmed no DB function or RLS policy
-- referenced the old literal string values before applying.
--
-- 'private' -> 'due_diligence': same underlying behavior as before
-- (computeCellEffect in people-access-matrix.ts treats it as "no grant can
-- ever have an effect" regardless of access_grants rows) — the name changes
-- to match the new icon/copy, but no "confirmed meeting" enforcement exists
-- yet; that part of Prompt 104 #3 was not specified concretely enough to
-- build and is flagged back, not invented.
-- 'link_anyone' -> 'open': same underlying behavior (today this is a label
-- only — access still flows entirely through access_grants either way).
alter type doc_visibility rename value 'private' to 'due_diligence';
alter type doc_visibility rename value 'link_anyone' to 'open';
